require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-extraction');
const XLSX = require('xlsx');

// --- CONFIGURATION ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DOCS_FOLDER = './docs'; // <--- Folder where you put your PDFs

// Initialize Clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- 1. HELPER: CHUNK TEXT ---
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

// --- 2. PROCESS PDF FILE ---
async function processPdfFile(filePath, fileName) {
    console.log(`\n📖 Reading PDF: ${fileName}...`);
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdf(dataBuffer);

        // Clean text
        const rawText = pdfData.text.replace(/\n\s*\n/g, '\n').trim();

        if (rawText.length < 50) {
            console.log(`⚠️  Skipping ${fileName}: Text too short or empty.`);
            return;
        }

        await uploadChunks(rawText, fileName, { source: fileName, page_count: pdfData.numpages });

    } catch (err) {
        console.error(`   ❌ Failed to process ${fileName}:`, err.message);
    }
}

// --- 3. PROCESS EXCEL FILE ---
async function processExcelFile(filePath, fileName) {
    console.log(`\n📊 Reading Excel: ${fileName}...`);
    try {
        const workbook = XLSX.readFile(filePath);
        let allText = '';

        // Process each sheet
        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];

            // Convert to JSON for better structure
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length === 0) continue;

            allText += `\n--- Sheet: ${sheetName} ---\n`;

            // Get headers (first row)
            const headers = jsonData[0] || [];

            // Process each row as a readable entry
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                // Create a readable string from the row
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

        await uploadChunks(allText, fileName, { source: fileName, sheet_count: workbook.SheetNames.length });

    } catch (err) {
        console.error(`   ❌ Failed to process ${fileName}:`, err.message);
    }
}

// --- 4. UPLOAD CHUNKS TO SUPABASE ---
async function uploadChunks(text, fileName, metadata) {
    const chunks = chunkText(text);
    console.log(`   -> Found ${chunks.length} chunks. Uploading...`);

    for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i];

        // Generate Embedding
        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: content,
        });
        const embedding = embeddingResponse.data[0].embedding;

        // Save to Supabase
        const { error } = await supabase.from('dot_knowledge_base').insert({
            content: content,
            embedding: embedding,
            metadata: metadata
        });

        if (error) {
            console.error(`   ❌ Error on chunk ${i+1}:`, error.message);
        } else {
            process.stdout.write('.'); // Print dot for progress
        }
    }
    console.log(`\n   ✅ ${fileName} complete!`);
}

// --- 5. MAIN LOOP ---
async function ingestAll() {
    console.log(`🔍 Scanning folder: ${DOCS_FOLDER}`);

    try {
        const files = fs.readdirSync(DOCS_FOLDER);
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');
        const excelFiles = files.filter(file => ['.xlsx', '.xls'].includes(path.extname(file).toLowerCase()));

        const totalFiles = pdfFiles.length + excelFiles.length;

        if (totalFiles === 0) {
            console.log("No PDF or Excel files found in the 'docs' folder.");
            return;
        }

        console.log(`Found ${pdfFiles.length} PDFs and ${excelFiles.length} Excel files. Starting ingestion...`);

        // Process PDF files
        for (const file of pdfFiles) {
            await processPdfFile(path.join(DOCS_FOLDER, file), file);
        }

        // Process Excel files
        for (const file of excelFiles) {
            await processExcelFile(path.join(DOCS_FOLDER, file), file);
        }

        console.log("\n🎉 All files processed successfully!");

    } catch (err) {
        console.error("Critical Error:", err.message);
    }
}

// Run it
ingestAll();