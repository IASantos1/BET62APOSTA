const http = require('http');

const url = 'http://127.0.0.1:8787/api/debug/run-22bet';

console.log(`Fetching 22Bet debug from ${url}...`);

http.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      if (result.error) {
          console.error('API Error:', result.error);
          return;
      }
      
      console.log('Summary:', {
          updates: result.updates,
          inserts: result.inserts,
          total: result.total
      });
      
      console.log('\n--- Logs ---');
      if (result.logs && Array.isArray(result.logs)) {
          result.logs.forEach(log => console.log(log));
      } else {
          console.log('No logs returned or logs is not an array.');
      }
      
      if (!result.logs && !result.updates) {
          console.log('Full Response:', JSON.stringify(result, null, 2));
      }

    } catch (e) {
      console.error('Error parsing JSON:', e.message);
      console.log('Raw data:', data);
    }
  });
}).on('error', (err) => {
  console.error('Error fetching debug endpoint:', err.message);
});
