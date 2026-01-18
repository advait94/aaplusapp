# Invoice Email Setup with n8n + Supabase Storage

This guide explains how to set up automated invoice emails using n8n Cloud and Outlook/Microsoft 365.

## Architecture Overview

```
Dashboard (Send Button)
         │
         ▼
┌─────────────────────────┐
│  1. Generate PDF        │
│  2. Upload to Storage   │
│  3. Insert pending row  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Supabase              │
│   • Storage: invoices/  │
│   • Table: pending_     │
│     invoices            │
│   • Database Webhook ───┼──────────┐
└─────────────────────────┘          │
                                     ▼
                           ┌─────────────────────────┐
                           │   n8n Workflow          │
                           │   • Webhook Trigger     │
                           │   • Download PDF        │
                           │   • Send via Outlook    │
                           │   • Update status       │
                           └─────────────────────────┘
```

**Flow:** Click Send → Generate PDF → Upload → Insert Row → Supabase Webhook → n8n sends email

---

## Step 1: Set Up Supabase Storage

1. Go to **Supabase Dashboard** > **Storage**
2. Click **New Bucket**
3. Name: `invoices`
4. Check **Public bucket** (allows direct URL access)
5. Click **Create bucket**

### Storage Policies (run in SQL Editor)

```sql
-- Allow authenticated users to upload
create policy "Allow authenticated uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'invoices');

-- Allow public read access for n8n to download
create policy "Allow public read" on storage.objects
  for select using (bucket_id = 'invoices');
```

---

## Step 2: Run Database Migration

Run the following SQL in **Supabase Dashboard** > **SQL Editor**:

```sql
-- Create pending_invoices table
create table if not exists public.pending_invoices (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  client_id text not null,
  client_name text not null,
  client_email text not null,
  invoice_number text not null,
  invoice_date date not null,
  amount numeric not null,
  invoice_type text check (invoice_type in ('recurring', 'project')) not null,
  project_name text,
  file_path text not null,
  file_url text not null,
  status text default 'pending' check (status in ('pending', 'sent', 'failed')),
  sent_at timestamp with time zone,
  error_message text
);

-- Enable RLS
alter table public.pending_invoices enable row level security;

-- Policy for authenticated access
drop policy if exists "Enable all access for authenticated users" on public.pending_invoices;
create policy "Enable all access for authenticated users" on public.pending_invoices
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Index for n8n queries
create index if not exists idx_pending_invoices_status on public.pending_invoices(status);
```

---

## Step 3: Set Up n8n Cloud

1. Go to [n8n.io](https://n8n.io) and sign up (free trial available)
2. Create a new workflow

---

## Step 4: Create n8n Workflow

### Workflow: "Invoice Email Sender"

Create the following nodes in order:

### Node 1: Webhook Trigger
- **Type:** Webhook
- **Settings:**
  - HTTP Method: POST
  - Path: `invoice-sender` (or any name you prefer)
  - Response Mode: When Last Node Finishes
- **Copy the Webhook URL** - you'll need this for the dashboard!

### Node 2: HTTP Request - Download PDF
- **Type:** HTTP Request
- **Method:** GET
- **URL:** `{{ $json.file_url }}`
- **Response Format:** File
- **Put Output in Field:** `pdf_data`

### Node 3: Microsoft Outlook - Send Email
- **Type:** Microsoft Outlook
- **Credentials:** Click "Create New" and sign in with your Microsoft 365 account
- **Resource:** Message
- **Operation:** Send
- **To:** `{{ $('Webhook').item.json.client_email }}`
- **Subject:** `Invoice #{{ $('Webhook').item.json.invoice_number }} - AA Plus Consultants`
- **Email Type:** HTML
- **Message:**
```html
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <h2 style="color: #10b981;">AA Plus Consultants</h2>
  <p>Dear {{ $('Webhook').item.json.client_name }},</p>
  <p>Please find attached your invoice.</p>
  <p><strong>Invoice Details:</strong></p>
  <ul>
    <li>Invoice Number: {{ $('Webhook').item.json.invoice_number }}</li>
    <li>Invoice Date: {{ $('Webhook').item.json.invoice_date }}</li>
    <li>Amount: INR {{ $('Webhook').item.json.amount }}</li>
  </ul>
  <p>Please process the payment at your earliest convenience.</p>
  <br>
  <p>Best regards,</p>
  <p><strong>Praveen Sharma</strong><br>
  AA Plus Consultants<br>
  +91 9212714422</p>
</div>
```
- **Attachments:**
  - Input Data Field Name: `pdf_data`
  - Filename: `Invoice_{{ $('Webhook').item.json.invoice_number }}.pdf`

### Node 4: Supabase - Update Status to Sent
- **Type:** Supabase
- **Credentials:** Create new (use your Supabase URL and service_role key from Project Settings > API)
- **Operation:** Update
- **Table:** `pending_invoices`
- **Filter:** `invoice_number` equals `{{ $('Webhook').item.json.invoice_number }}`
- **Fields to Update:**
  - `status`: `sent`
  - `sent_at`: `{{ $now.toISO() }}`

---

## Step 5: Configure Supabase Database Webhook

Instead of calling n8n from the browser (which causes CORS issues), we use Supabase Database Webhooks to trigger n8n server-side.

1. **Activate your n8n workflow** (toggle ON)
2. **Copy the Production Webhook URL** from Node 1:
   - Should look like: `https://your-instance.app.n8n.cloud/webhook/xxxxx`
   - Make sure it's `webhook` NOT `webhook-test`

3. **In Supabase Dashboard**, go to **Database** → **Webhooks**

4. **Click "Create a new webhook"** and configure:
   - **Name:** `send-invoice-email`
   - **Table:** `pending_invoices`
   - **Events:** Check **INSERT**
   - **Type:** HTTP Request
   - **Method:** POST
   - **URL:** Your n8n production webhook URL
   - **HTTP Headers:** Add:
     - `Content-Type`: `application/json`

5. **Click "Create webhook"**

Now when a row is inserted into `pending_invoices`, Supabase automatically calls n8n!

---

## Step 6: Test the Workflow

1. Ensure n8n workflow is **activated** (toggle ON)
2. Go to your Admin Dashboard
3. Click the green **Send** button next to any client
4. You should see progress: "Generating..." → "Creating PDF..." → "Uploading..." → "Sending..."
5. Check Supabase Storage - the PDF should appear in the `invoices` bucket
6. Check `pending_invoices` table - status should change from `pending` to `sent`
7. Check your Outlook sent folder and the recipient's inbox - email should arrive within seconds!

---

## Step 7: Monthly Automation (Optional)

Create a second workflow: **"Monthly Invoice Generator"**

### Node 1: Schedule Trigger
- Cron: `0 9 1 * *` (9:00 AM on 1st of each month)

### Node 2: Supabase - Get All Recurring Clients
- **Table:** `clients`
- **Filters:** `recurring_amount` > 0

### Node 3: Loop Over Items

### Node 4: Code Node (Generate Invoice Data)
```javascript
const client = $input.item.json;
const now = new Date();
const invNum = `G${String(Math.floor(Math.random() * 9000) + 1000)}`;

return {
  client_id: client.client_id,
  client_name: client.official_name,
  client_email: client.sender_email,
  invoice_number: invNum,
  invoice_date: now.toISOString().split('T')[0],
  amount: client.recurring_amount,
  invoice_type: 'recurring',
  status: 'pending'
  // Note: file_path and file_url will need to be generated
  // This is a simplified version - full implementation requires
  // generating the PDF server-side or triggering the dashboard
};
```

For full monthly automation, you may want to:
- Use a webhook from n8n to trigger the dashboard to generate invoices
- Or create a separate PDF generation service

---

## Troubleshooting

### "Upload failed" error
- Ensure the `invoices` storage bucket exists and is public
- Check storage policies are created

### "Failed to queue invoice" error
- Run the database migration SQL
- Check RLS policies on `pending_invoices` table

### Emails not sending
- Check n8n workflow execution logs
- Verify Microsoft 365 credentials are valid
- Check `pending_invoices` table for `status: failed` entries

### PDF quality issues
- The PDF is generated from HTML using html2canvas
- Ensure all fonts are loaded before generation
- The 500ms delay in the code allows for rendering

---

## Files Modified

| File | Changes |
|------|---------|
| `database_setup.sql` | Added `pending_invoices` table and storage bucket SQL |
| `admin_dashboard.html` | Added jsPDF/html2canvas, updated sendInvoiceEmail() |

---

## n8n Workflow Export

You can import this workflow JSON into n8n (adjust credentials):

```json
{
  "name": "Invoice Email Sender",
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "position": [250, 300],
      "parameters": {
        "rule": {
          "interval": [{ "field": "minutes", "minutesInterval": 5 }]
        }
      }
    }
  ],
  "connections": {}
}
```

(Full workflow JSON available in n8n template library or can be exported after manual creation)
