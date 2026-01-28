const fetch = require('node-fetch');

async function testAPI() {
  try {
    // Get auth token (you'll need to replace this with a valid token)
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // Replace with actual token
    
    // Test the tracked-channels endpoint
    const url = 'http://localhost:3000/tracked-channels/by-username/TIKTOK/huyk.trangsucchetac';
    
    console.log(`Calling: ${url}\n`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    
    console.log('Response Status:', response.status);
    console.log('\nResponse Data:');
    console.log(JSON.stringify(data, null, 2));
    
    console.log('\n=== KEY FIELDS ===');
    console.log(`total_followers: ${data.total_followers}`);
    console.log(`followers_count: ${data.followers_count}`);
    console.log(`display_name: ${data.display_name}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// For testing without token, let's check what the service returns
console.log('Note: You need to add a valid auth token to test the API');
console.log('Check the browser DevTools > Application > LocalStorage > auth_token\n');
