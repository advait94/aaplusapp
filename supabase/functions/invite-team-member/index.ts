import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Get request data
    const { 
      email, 
      parentUserId, 
      allowedCategories,
      companyName 
    } = await req.json()

    if (!email) throw new Error("Email is required")
    if (!parentUserId) throw new Error("Parent user ID is required")
    if (!allowedCategories || !Array.isArray(allowedCategories) || allowedCategories.length === 0) {
      throw new Error("At least one allowed category is required")
    }

    // 2. Initialize Supabase Admin Client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 3. Check parent user exists and is premium
    const { data: parentProfile, error: parentError } = await supabase
      .from('profiles')
      .select('id, tier, company_name')
      .eq('id', parentUserId)
      .single()

    if (parentError || !parentProfile) {
      throw new Error("Parent user not found")
    }

    if (parentProfile.tier !== 'premium') {
      throw new Error("Team members are only available for premium accounts")
    }

    // 4. Check team member limit (max 6)
    const { count, error: countError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parentUserId)

    if (countError) throw new Error(`Failed to count team members: ${countError.message}`)
    if ((count || 0) >= 6) {
      throw new Error("Maximum team member limit (6) reached")
    }

    // 5. Check if email already exists
    const { data: existingUser } = await supabase.auth.admin.listUsers()
    const emailExists = existingUser?.users?.some(u => u.email === email)
    if (emailExists) {
      throw new Error("A user with this email already exists")
    }

    // 6. Create the auth user with invite
    const { data: userData, error: createUserError } = await supabase.auth.admin.createUser({
      email: email,
      email_confirm: false,
      user_metadata: {
        company_name: companyName || parentProfile.company_name,
        invited_by: parentUserId
      }
    })

    if (createUserError) throw new Error(`Failed to create user: ${createUserError.message}`)
    if (!userData.user) throw new Error("User creation returned no user data")

    const teamMemberId = userData.user.id

    // 7. Create the profile as team member (viewer role)
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: teamMemberId,
        company_name: companyName || parentProfile.company_name,
        tier: 'basic', // Team members are basic tier
        access_role: 'viewer',
        allowed_categories: allowedCategories,
        parent_id: parentUserId
      })

    if (profileError) throw new Error(`Failed to create profile: ${profileError.message}`)

    // 8. Send invite email
    const { error: inviteError } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email: email,
      options: {
        redirectTo: 'https://qitojxxbqsgypbavkkch.supabase.co/profile.html'
      }
    })

    if (inviteError) {
      console.warn('Could not generate invite link:', inviteError.message)
    }

    // 9. Return success
    return new Response(
      JSON.stringify({
        success: true,
        message: `Team member ${email} invited successfully`,
        userId: teamMemberId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge Function Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
