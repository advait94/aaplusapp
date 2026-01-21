import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { OpenAI } from 'jsr:@openai/openai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // 1. Handle CORS (Allow your website to talk to this function)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Get User Input and Conversation History
    const { query, messages: conversationHistory = [] } = await req.json()
    if (!query) throw new Error("No query provided")

    // 3. Initialize Clients
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    })

    // 4. Create Embedding for the Question (Text -> Numbers)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
    const questionEmbedding = embeddingResponse.data[0].embedding

    // 5. Search Database for Matching Context
    const { data: documents, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: questionEmbedding,
      match_threshold: 0.4, // 40% similarity - lower to catch Excel data
      match_count: 10       // Get top 10 matching paragraphs for better coverage
    })

    if (matchError) throw matchError

    // 6. Build the Context String with Source Citations
    let contextText = ""
    let sources: string[] = []
    if (documents && documents.length > 0) {
      contextText = documents.map((d: any, idx: number) => {
        const source = d.metadata?.source || 'Unknown Document'
        if (!sources.includes(source)) sources.push(source)
        return `[Source ${idx + 1}: ${source}]\n${d.content}`
      }).join("\n\n---\n\n")
    } else {
      return new Response(
        JSON.stringify({ answer: "I couldn't find any relevant information about that in my knowledge base. This question may be outside the scope of the documents I have access to. Please ask a question related to DoT compliance regulations." }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 7. Build messages array with conversation history
    const systemMessage = {
      role: 'system',
      content: `You are a DoT (Department of Telecommunications) compliance expert assistant. You MUST follow these rules strictly:

STRICT RULES:
1. ONLY answer questions using the information provided in the Context below. Do not use any external knowledge.
2. If the Context does not contain information to answer the question, respond with: "I don't have information about that in my knowledge base. Please ask a question related to the DoT compliance documents I have access to."
3. NEVER make up, invent, or assume any rules, regulations, or information not explicitly stated in the Context.
4. Always cite which source document your answer comes from (e.g., "According to the UL Agreement..." or "As stated in the VNO Agreement...").
5. If asked about topics unrelated to telecommunications compliance (like weather, sports, general knowledge), politely decline and redirect to DoT-related questions.
6. Be precise and quote specific clauses or sections when available.
7. You have access to the conversation history. Use it to understand follow-up questions and pronouns like "it", "that", "this", etc.

Available Source Documents: ${sources.join(', ')}

Context:
${contextText}`
    }

    // Build messages: system + conversation history (limit to last 10 exchanges to manage tokens)
    const recentHistory = conversationHistory.slice(-10)
    const chatMessages = [
      systemMessage,
      ...recentHistory.map((m: any) => ({ role: m.role, content: m.content }))
    ]

    // 8. Ask GPT-4 to Answer using the Context and History
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: chatMessages,
      temperature: 0.4, // Keep it factual, low creativity
    })

    const answer = chatCompletion.choices[0].message.content

    // 9. Return the Answer
    return new Response(
      JSON.stringify({ answer }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge Function Error:', error)
    return new Response(
      JSON.stringify({
        error: error.message,
        answer: `Error: ${error.message}. Please try again.`
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})