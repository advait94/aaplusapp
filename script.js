// 1. Initialize Supabase
// REPLACE THESE WITH YOUR ACTUAL SUPABASE KEYS
const supabaseUrl = 'https://qitojxxbqsgypbavkkch.supabase.co';
const supabaseKey = 'sb_publishable_PCJvu-s9XkCDGUvDZgsXhQ_myIhmu4t';

const client = supabase.createClient(supabaseUrl, supabaseKey);

// 2. Listen for the BUTTON CLICK (Not form submit)
const loginBtn = document.getElementById('login-btn');

loginBtn.addEventListener('click', async () => {
    
    // Note: We don't need e.preventDefault() anymore because 
    // type="button" doesn't try to refresh the page!

    const email = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    console.log("Button clicked. Email:", email); // Debug check

    // Check if empty so we don't send bad data
    if (!email || !password) {
        alert("Please enter both email and password.");
        return;
    }

    // Change button text
    const originalText = loginBtn.innerText;
    loginBtn.innerText = "Verifying...";
    loginBtn.disabled = true;

    // 3. Send to Supabase
    const { data, error } = await client.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        console.error("Login Failed:", error.message);
        alert("Login Error: " + error.message);
        loginBtn.innerText = originalText;
        loginBtn.disabled = false;
    } else {
        console.log("Login Successful!");
        // 4. Redirect
        const adminEmails = ['advait@aaplusconsultants.com', 'radhakrishnan@aaplusconsultants.com', 'praveen@aaplusconsultants.com'];
        if (adminEmails.includes(email)) {
             window.location.href = "admin_dashboard.html";
        } else {
             window.location.href = "client_dashboard.html";
        }
    }
});