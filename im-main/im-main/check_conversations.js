const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/conversations',
    method: 'GET',
    headers: {
        'x-im-token': 'imdevtoken'
    }
};

const req = http.request(options, res => {
    console.log(`statusCode: ${res.statusCode}`);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json.slice(0, 2), null, 2));
        } catch (e) {
            console.log(data);
        }
    });
});

req.on('error', error => {
    console.error(error);
});

req.end();
