-- License Applications Table Update for Approval Workflow
-- Run this in Supabase SQL Editor

-- First, check if table exists and add missing columns
-- This is idempotent - can be run multiple times safely

-- Add official_email if not exists (needed for user creation)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'license_applications' AND column_name = 'official_email') THEN
        ALTER TABLE license_applications ADD COLUMN official_email TEXT;
    END IF;
END $$;

-- Add approved_at timestamp
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'license_applications' AND column_name = 'approved_at') THEN
        ALTER TABLE license_applications ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add rejected_at timestamp
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'license_applications' AND column_name = 'rejected_at') THEN
        ALTER TABLE license_applications ADD COLUMN rejected_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add admin_notes for rejection reason or approval notes
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'license_applications' AND column_name = 'admin_notes') THEN
        ALTER TABLE license_applications ADD COLUMN admin_notes TEXT;
    END IF;
END $$;

-- Add approved_by to track which admin approved
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'license_applications' AND column_name = 'approved_by') THEN
        ALTER TABLE license_applications ADD COLUMN approved_by UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- Add created_user_id to link to the created user after approval
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'license_applications' AND column_name = 'created_user_id') THEN
        ALTER TABLE license_applications ADD COLUMN created_user_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- Create index on status for faster filtering
CREATE INDEX IF NOT EXISTS idx_license_applications_status ON license_applications(status);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_license_applications_created_at ON license_applications(created_at DESC);

-- RLS Policy: Admins can view all applications
-- First drop existing policy if it exists
DROP POLICY IF EXISTS "Admins can view all applications" ON license_applications;

-- Create policy for admin access
CREATE POLICY "Admins can view all applications" ON license_applications
    FOR SELECT
    USING (
        auth.email() IN (
            'advait@aaplusconsultants.com',
            'radhakrishnan@aaplusconsultants.com',
            'praveen@aaplusconsultants.com',
            'rishabh@aaplusconsultants.com'
        )
    );

-- RLS Policy: Admins can update applications (for approval/rejection)
DROP POLICY IF EXISTS "Admins can update applications" ON license_applications;

CREATE POLICY "Admins can update applications" ON license_applications
    FOR UPDATE
    USING (
        auth.email() IN (
            'advait@aaplusconsultants.com',
            'radhakrishnan@aaplusconsultants.com',
            'praveen@aaplusconsultants.com',
            'rishabh@aaplusconsultants.com'
        )
    );

-- Users can view their own applications
DROP POLICY IF EXISTS "Users can view own applications" ON license_applications;

CREATE POLICY "Users can view own applications" ON license_applications
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own applications
DROP POLICY IF EXISTS "Users can insert own applications" ON license_applications;

CREATE POLICY "Users can insert own applications" ON license_applications
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Enable RLS on the table if not already enabled
ALTER TABLE license_applications ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON license_applications TO authenticated;

-- Verify the table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'license_applications'
ORDER BY ordinal_position;
