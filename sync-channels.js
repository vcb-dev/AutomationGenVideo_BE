
import fetch from 'node-fetch';

async function sync() {
    try {
        const res = await fetch('http://localhost:3000/api/lark/sync-channel', { method: 'POST' });
        const data = await res.json();
        console.log(data);
    } catch (e) {
        console.error(e);
    }
}

sync();
