require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// --- CONFIGURATION ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DOCS_FOLDER = './docs';

// Initialize Clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- CHUNK TEXT ---
function chunkText(text, maxLength = 1000) {
    const chunks = [];
    let currentChunk = "";
    const sentences = text.replace(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|");

    for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
        }
        currentChunk += sentence + " ";
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

// --- PROCESS EXCEL FILE ---
async function processExcelFile(filePath, fileName) {
    console.log(`\n📊 Reading Excel: ${fileName}...`);
    try {
        const workbook = XLSX.readFile(filePath);
        let allText = '';

        // Process each sheet
        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length === 0) continue;

            allText += `\n--- Sheet: ${sheetName} ---\n`;
            const headers = jsonData[0] || [];

            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                let rowText = '';
                for (let j = 0; j < row.length; j++) {
                    if (row[j] !== undefined && row[j] !== null && row[j] !== '') {
                        const header = headers[j] || `Column${j + 1}`;
                        rowText += `${header}: ${row[j]}. `;
                    }
                }
                if (rowText) {
                    allText += rowText + '\n';
                }
            }
        }

        if (allText.length < 50) {
            console.log(`⚠️  Skipping ${fileName}: Content too short or empty.`);
            return;
        }

        const chunks = chunkText(allText);
        console.log(`   -> Found ${chunks.length} chunks. Uploading...`);

        for (let i = 0; i < chunks.length; i++) {
            const content = chunks[i];

            const embeddingResponse = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: content,
            });
            const embedding = embeddingResponse.data[0].embedding;

            const { error } = await supabase.from('dot_knowledge_base').insert({
                content: content,
                embedding: embedding,
                metadata: { source: fileName, sheet_count: workbook.SheetNames.length }
            });

            if (error) {
                console.error(`   ❌ Error on chunk ${i+1}:`, error.message);
            } else {
                process.stdout.write('.');
            }
        }
        console.log(`\n   ✅ ${fileName} complete!`);

    } catch (err) {
        console.error(`   ❌ Failed to process ${fileName}:`, err.message);
    }
}

// --- MAIN ---
async function main() {
    console.log(`🔍 Scanning for Excel files in: ${DOCS_FOLDER}`);

    const files = fs.readdirSync(DOCS_FOLDER);
    const excelFiles = files.filter(file => ['.xlsx', '.xls'].includes(path.extname(file).toLowerCase()));

    if (excelFiles.length === 0) {
        console.log("No Excel files found.");
        return;
    }

    console.log(`Found ${excelFiles.length} Excel file(s). Starting ingestion...`);

    for (const file of excelFiles) {
        await processExcelFile(path.join(DOCS_FOLDER, file), file);
    }

    console.log("\n🎉 Excel ingestion complete!");
}

main();
