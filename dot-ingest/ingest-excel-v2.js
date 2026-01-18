require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const XLSX = require('xlsx');

// --- CONFIGURATION ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Format number as Indian currency
function formatIndianCurrency(num) {
    if (num === 0) return 'Nil';
    if (typeof num === 'string') return num;
    return '₹' + num.toLocaleString('en-IN');
}

// Convert row to natural language
function rowToNaturalLanguage(row, headers, licenseType) {
    const service = row[1] || 'Unknown Service';
    const entry = {
        service: service,
        minEquity: row[2],
        minNetworth: row[3],
        entryFees: row[4],
        pbg: row[5],
        fbg: licenseType === 'UL' ? row[6] : row[5],
        appFee: licenseType === 'UL' ? row[7] : row[6]
    };

    // Create multiple natural language descriptions for better matching
    const sentences = [];

    // Main description
    sentences.push(
        `For ${licenseType} License - ${entry.service}: ` +
        `The Entry Fee is ${formatIndianCurrency(entry.entryFees)}. ` +
        `Minimum Equity requirement is ${formatIndianCurrency(entry.minEquity)}. ` +
        `Minimum Networth requirement is ${formatIndianCurrency(entry.minNetworth)}.`
    );

    // Bank guarantee info
    if (licenseType === 'UL') {
        sentences.push(
            `${licenseType} ${entry.service} requires Performance Bank Guarantee (PBG) of ${formatIndianCurrency(entry.pbg)} ` +
            `and Financial Bank Guarantee (FBG) of ${formatIndianCurrency(entry.fbg)}. ` +
            `Application Processing Fee is ${formatIndianCurrency(entry.appFee)}.`
        );
    } else {
        sentences.push(
            `${licenseType} ${entry.service} requires Financial Bank Guarantee (FBG) of ${formatIndianCurrency(entry.fbg)}. ` +
            `Application Processing Fee is ${formatIndianCurrency(entry.appFee)}.`
        );
    }

    return sentences.join('\n');
}

// Create comparison text between UL and VNO
function createComparisonText(ulRows, vnoRows, headers) {
    const comparisons = [];

    // Find matching services
    const ulServices = {};
    ulRows.forEach(row => {
        if (row[1]) ulServices[row[1].toLowerCase().trim()] = row;
    });

    vnoRows.forEach(vnoRow => {
        const serviceName = vnoRow[1];
        if (!serviceName) return;

        // Try to find matching UL service
        const ulKey = Object.keys(ulServices).find(k =>
            k.includes('access') && serviceName.toLowerCase().includes('access') ||
            k.includes('nld') && serviceName.toLowerCase().includes('nld') ||
            k.includes('ild') && serviceName.toLowerCase().includes('ild') ||
            k.includes('vsat') && serviceName.toLowerCase().includes('vsat') ||
            k.includes('isp') && serviceName.toLowerCase().includes('isp') ||
            k.includes('gmpcs') && serviceName.toLowerCase().includes('gmpcs')
        );

        if (ulKey) {
            const ulRow = ulServices[ulKey];
            comparisons.push(
                `Comparison of Entry Fees for Access Service: ` +
                `UL License Entry Fee is ${formatIndianCurrency(ulRow[4])} while ` +
                `UL(VNO) License Entry Fee is ${formatIndianCurrency(vnoRow[4])}. ` +
                `The difference is that UL requires higher Entry Fees than UL(VNO).`
            );
            comparisons.push(
                `Comparing ${ulRow[1]} (UL) vs ${serviceName} (VNO): ` +
                `UL requires Minimum Equity of ${formatIndianCurrency(ulRow[2])} and Networth of ${formatIndianCurrency(ulRow[3])}, ` +
                `whereas VNO requires Minimum Equity of ${formatIndianCurrency(vnoRow[2])} and Networth of ${formatIndianCurrency(vnoRow[3])}.`
            );
        }
    });

    return comparisons;
}

async function uploadChunk(content, metadata) {
    const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: content,
    });
    const embedding = embeddingResponse.data[0].embedding;

    const { error } = await supabase.from('dot_knowledge_base').insert({
        content: content,
        embedding: embedding,
        metadata: metadata
    });

    if (error) {
        console.error('Error:', error.message);
        return false;
    }
    return true;
}

async function main() {
    console.log('📊 Reading FeeComparision.xlsx with improved natural language formatting...\n');

    const workbook = XLSX.readFile('./docs/FeeComparision.xlsx');
    const chunks = [];

    // Process UL sheet
    const ulSheet = workbook.Sheets['UL'];
    const ulData = XLSX.utils.sheet_to_json(ulSheet, { header: 1 });
    const ulHeaders = ulData[0];
    const ulRows = ulData.slice(1).filter(row => row.length > 0 && row[1]);

    console.log(`Found ${ulRows.length} UL services`);

    // Process VNO sheet
    const vnoSheet = workbook.Sheets['UL(VNO)'];
    const vnoData = XLSX.utils.sheet_to_json(vnoSheet, { header: 1 });
    const vnoHeaders = vnoData[0];
    const vnoRows = vnoData.slice(1).filter(row => row.length > 0 && row[1]);

    console.log(`Found ${vnoRows.length} VNO services`);

    // Create natural language chunks for each UL service
    for (const row of ulRows) {
        const text = rowToNaturalLanguage(row, ulHeaders, 'UL');
        chunks.push({ content: text, type: 'UL' });
    }

    // Create natural language chunks for each VNO service
    for (const row of vnoRows) {
        const text = rowToNaturalLanguage(row, vnoHeaders, 'UL(VNO)');
        chunks.push({ content: text, type: 'VNO' });
    }

    // Create comparison chunks (important for "difference" queries)
    const comparisons = createComparisonText(ulRows, vnoRows, ulHeaders);
    comparisons.forEach(comp => {
        chunks.push({ content: comp, type: 'Comparison' });
    });

    // Add a summary chunk
    const summaryChunk = `
Fee Comparison Summary for DoT Licenses:

UL (Unified License) Entry Fees:
- UL (All Services): ${formatIndianCurrency(150000000)}
- Access Service: ${formatIndianCurrency(10000000)} (${formatIndianCurrency(5000000)} for J&K)
- NLD: ${formatIndianCurrency(25000000)}
- ILD: ${formatIndianCurrency(25000000)}

UL(VNO) Entry Fees (generally lower than UL):
- UL(VNO) All Services: ${formatIndianCurrency(75000000)}
- Access Service: ${formatIndianCurrency(5000000)} (${formatIndianCurrency(2500000)} for J&K)
- NLD: ${formatIndianCurrency(12500000)}
- ILD: ${formatIndianCurrency(12500000)}

Key Difference: UL(VNO) licenses have approximately 50% lower Entry Fees compared to UL licenses for most services.
    `.trim();
    chunks.push({ content: summaryChunk, type: 'Summary' });

    console.log(`\nTotal chunks to upload: ${chunks.length}`);
    console.log('Uploading...\n');

    let success = 0;
    for (const chunk of chunks) {
        const ok = await uploadChunk(chunk.content, {
            source: 'FeeComparision.xlsx',
            type: chunk.type
        });
        if (ok) {
            success++;
            process.stdout.write('.');
        }
    }

    console.log(`\n\n✅ Uploaded ${success}/${chunks.length} chunks successfully!`);
}

main();
