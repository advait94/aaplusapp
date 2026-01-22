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
    const { signupRequestId, adminNotes } = await req.json()
    if (!signupRequestId) throw new Error("No signup request ID provided")

    // 2. Initialize Supabase Admin Client (uses service role key)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 3. Fetch the signup request
    const { data: signupRequest, error: fetchError } = await supabase
      .from('signup_requests')
      .select('*')
      .eq('id', signupRequestId)
      .single()

    if (fetchError) throw new Error(`Failed to fetch signup request: ${fetchError.message}`)
    if (!signupRequest) throw new Error("Signup request not found")
    if (signupRequest.status !== 'pending') throw new Error("Signup request is not pending")

    // 4. Services are now stored pre-formatted from the signup form
    const formattedServices = signupRequest.services || []

    // 5. Create the auth user (without password - user will set via reset link)
    const { data: userData, error: createUserError } = await supabase.auth.admin.createUser({
      email: signupRequest.email,
      email_confirm: true, // Mark email as confirmed
      user_metadata: {
        company_name: signupRequest.company_name
      }
    })

    if (createUserError) throw new Error(`Failed to create user: ${createUserError.message}`)
    if (!userData.user) throw new Error("User creation returned no user data")

    const userId = userData.user.id

    // 6. Create the profile with formatted services
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        company_name: signupRequest.company_name,
        tier: signupRequest.tier,
        license_type: signupRequest.license_type,
        services: formattedServices,
        access_role: 'admin',
        allowed_categories: ['All']
      })

    if (profileError) throw new Error(`Failed to create profile: ${profileError.message}`)

    // 7. Generate magic link (recovery type) - DO NOT send email, just get the link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: signupRequest.email,
      options: {
        redirectTo: 'https://compliance-app-sage.vercel.app/set-password.html'
      }
    })

    if (linkError) throw new Error(`Failed to generate link: ${linkError.message}`)
    
    // The magic link is in linkData.properties.action_link
    const magicLink = linkData?.properties?.action_link || null

    // 8. Update signup request: set status to approved AND store the magic link
    const { error: updateError } = await supabase
      .from('signup_requests')
      .update({
        status: 'approved',
        admin_notes: adminNotes || null,
        reviewed_at: new Date().toISOString(),
        magic_link: magicLink
      })
      .eq('id', signupRequestId)

    if (updateError) throw new Error(`Failed to update signup request: ${updateError.message}`)

    // 9. Return success - email will be sent via n8n webhook triggered by database change
    return new Response(
      JSON.stringify({
        success: true,
        message: `User approved! Magic link stored. Configure n8n webhook to send email.`,
        userId: userId,
        email: signupRequest.email
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
