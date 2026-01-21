# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComplianceApp is a Telecommunications Compliance and Invoice Management Platform for AA Plus Consultants. It combines compliance tracking (DoT regulations), automated invoice generation/delivery, expert consultation booking, and an AI-powered knowledge base chatbot.

## Development Commands

```bash
# Start local development server
npm start                    # Runs live-server on port 3000

# Run knowledge base ingestion (from dot-ingest folder)
cd dot-ingest && node ingest.js           # Ingest PDF documents
cd dot-ingest && node ingest-excel-v2.js  # Ingest Excel files
```

## Architecture

```
Frontend (Static HTML/JS)     →    Supabase (PostgreSQL + Auth + Storage)
     ↓                                        ↓
  jsPDF (invoice generation)           n8n Cloud (webhook automation)
                                              ↓
                                      Outlook 365 (email delivery)
```

**No traditional backend** - all logic is either client-side JavaScript or Supabase Edge Functions. Database webhooks trigger n8n workflows for async processing (e.g., sending invoices via email).

### Project Structure

```
ComplianceApp/
├── assets/                     # Images & media files
│   ├── AAPlus Logo.png         # Company logo (used across all pages)
│   ├── papasignature.PNG       # Director signature for invoices
│   └── sign Final.png          # Alternate signature
│
├── docs/                       # Reference documents (not deployed)
│   ├── GCX Invoice Format.pdf  # Invoice template reference
│   ├── N8N_INVOICE_SETUP.md    # n8n workflow setup guide
│   └── [expense/invoice files] # Sample documents
│
├── sql/                        # Database schemas
│   ├── database_setup.sql      # Main schema with RLS policies
│   ├── contractor_bills_schema.sql
│   └── test_compliance_data.sql
│
├── dot-ingest/                 # AI knowledge base ingestion scripts
│   ├── ingest.js               # PDF document ingestion
│   └── ingest-excel-v2.js      # Excel file ingestion
│
├── index.html                  # Login portal
├── client_dashboard.html       # Client interface
├── admin_dashboard.html        # Admin interface
├── apply_license.html          # License application form
├── profile.html                # Password reset page
└── presentation.html           # Sales presentation
```

### Key Files

| File | Purpose |
|------|---------|
| `index.html` | Login portal with Supabase auth |
| `client_dashboard.html` | Client interface: compliance tracking, AI chat, expert consultation |
| `admin_dashboard.html` | Admin interface: invoice management, client/employee management |
| `apply_license.html` | New telecom license application form |
| `sql/database_setup.sql` | Complete PostgreSQL schema with RLS policies and vector functions |
| `dot-ingest/ingest.js` | PDF ingestion script for AI knowledge base |
| `assets/` | All images referenced by HTML files |

### Database Tables (Key)

- **clients** - Recurring billing clients with invoice templates
- **compliance_library** - DoT compliance rules by license type (UL, UL-VNO, etc.)
- **user_progress** - Tracks which compliance items each user has completed
- **consultation_requests** - Expert consultation tickets with urgency levels
- **pending_invoices** - Email queue processed by n8n webhook
- **dot_knowledge_base** - Vector embeddings (pgvector, 1536 dimensions) for AI chatbot
- **invoice_logs** - Audit trail for all generated invoices

### Core Workflows

1. **Invoice Flow**: Admin clicks "Send Invoice" → PDF generated (jsPDF) → Uploaded to Storage → Row inserted in `pending_invoices` → Database webhook triggers n8n → n8n sends via Outlook → Status updated to 'sent'

2. **Compliance Tracking**: Rules fetched from `compliance_library` filtered by user's license type → Merged with `user_progress` → Rendered with urgency scoring (base_severity * 10 + time-based boost)

3. **AI Chatbot**: Query → Supabase Edge Function `ask-dot-expert` → Embed query (OpenAI) → Vector similarity search in `dot_knowledge_base` → Generate response with context

### Authentication

- Uses Supabase Auth (email/password)
- Admin emails hardcoded: `advait@aaplusconsultants.com`, `radhakrishnan@aaplusconsultants.com`, `praveen@aaplusconsultants.com`
- Row-Level Security (RLS) policies enforce access control

### External Services

- **Supabase**: Database, Auth, Storage, Edge Functions
- **n8n Cloud**: Workflow automation (triggered by database webhooks)
- **OpenAI API**: Embeddings (text-embedding-3-small) and chat completion
- **Microsoft Outlook 365**: Email delivery for invoices

### Frontend Libraries (CDN)

- Supabase JS SDK v2
- jsPDF + html2canvas (PDF generation)
- XLSX (Excel parsing)
- Font Awesome 6.0
