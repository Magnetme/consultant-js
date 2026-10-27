'use strict';

const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const http = require('node:http');
const {describe, it} = require('node:test');
const {gzipSync} = require('node:zlib');

// Use an ordinary child process so node:test's own exception handlers cannot
// hide an unhandled rejection. The caller handles only the public health promise.
const client = `
const assert = require('node:assert/strict');
const expected = process.argv[3];
let drained;
if (expected === 'drained-status') {
	// Observe the real response without consuming it on the client's behalf.
	const fetchPath = require.resolve('node-fetch', {paths: [process.argv[1]]});
	const fetch = require(fetchPath);
	require.cache[fetchPath].exports = (...args) => fetch(...args).then(response => {
		drained = new Promise(resolve => response.body.once('end', resolve));
		return response;
	});
}
const {health} = require(process.argv[1]);
async function main() {
	try {
		const value = await health({consulHost: process.argv[2], service: 'api'});
		assert.equal(expected, 'success');
		assert.deepEqual(value, [{Service: {ID: 'api-1'}}]);
		console.log('health fulfilled with expected service');
	}
	catch (error) {
		if (expected === 'success') throw error;
		if (expected === 'status' || expected === 'drained-status') {
			assert.equal(error.name, 'ConsultantError');
			assert.match(error.message, /status (403|500)/);
			assert.equal(error.message.includes('synthetic rejection'), false);
		}
		else {
			assert.equal(error.name, 'FetchError');
		}
		console.log('caller caught health rejection: ' + error.name);
	}
	if (expected === 'drained-status') await drained;
	// Let deferred stream/decompression failures surface under Node's defaults.
	setTimeout(() => console.log('caller remained alive'), 100);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`;

async function runHealth(test, {status, encoding, body, terminate, expected}) {
	let requests = 0;
	const server = http.createServer((request, response) => {
		assert.equal(request.method, 'GET');
		assert.equal(request.url, '/v1/health/service/api?near=_agent&passing=true');
		requests += 1;
		const headers = {'content-type' : 'application/json'};
		if (encoding) headers['content-encoding'] = encoding;
		if (terminate) headers['content-length'] = 10000;
		response.writeHead(status, headers);
		if (terminate) {
			response.write(body);
			const timer = setTimeout(() => response.destroy(), 20);
			test.after(() => clearTimeout(timer));
		}
		else {
			response.end(body);
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	test.after(() => new Promise(resolve => server.close(resolve)));
	const host = `http://127.0.0.1:${server.address().port}`;
	const env = Object.assign({}, process.env, {NODE_OPTIONS : ''});
	// Do not inherit node:test's child context or any process-wide error policy.
	delete env.NODE_TEST_CONTEXT;
	const outcome = await new Promise(resolve => {
		execFile(process.execPath, ['-e', client, require.resolve('../out'), host, expected], {
			env,
			timeout : 5000
		}, (error, stdout, stderr) => resolve({error, stdout, stderr}));
	});
	assert.equal(requests, 1, 'the actual client must reach the fixture');
	assert.equal(outcome.error && outcome.error.code, null, `Child failed after handling health():\n${outcome.stdout}\n${outcome.stderr}`);
	assert.match(outcome.stdout, /caller remained alive/);
	assert.equal(outcome.stderr, '');
	assert.match(outcome.stdout, expected === 'success' ? /health fulfilled/ : /caller caught health rejection/);
}

describe('health response body failures stay inside the caller promise', () => {
	const validBody = JSON.stringify([{Service : {ID : 'api-1'}}]);
	for (const encoding of [undefined, 'gzip']) {
		it(`accepts a normal 200 ${encoding || 'plain'} response in an ordinary process`, async test => {
			await runHealth(test, {status : 200, encoding, body : encoding ? gzipSync(validBody) : validBody, expected : 'success'});
		});
		it(`allows a caller to catch a normal 403 ${encoding || 'plain'} response`, async test => {
			const body = 'synthetic rejection';
			await runHealth(test, {status : 403, encoding, body : encoding ? gzipSync(body) : body, expected : 'status'});
		});
		it(`releases the connection after a large 500 ${encoding || 'plain'} response`, async test => {
			// Exceed both stream and socket buffers, even after compression.
			const body = randomBytes(8 * 1024 * 1024);
			await runHealth(test, {status : 500, encoding, body : encoding ? gzipSync(body) : body, expected : 'drained-status'});
		});
	}
	for (const status of [403, 500]) {
		it(`survives a malformed gzip ${status} response after catching health()`, async test => {
			await runHealth(test, {status, encoding : 'gzip', body : 'not a gzip stream', expected : 'status'});
		});
	}
	it('keeps malformed gzip on 200 attached to the returned health promise', async test => {
		await runHealth(test, {status : 200, encoding : 'gzip', body : 'not a gzip stream', expected : 'body-error'});
	});
	it('survives a terminated 403 error body after catching health()', async test => {
		await runHealth(test, {status : 403, body : 'partial response', terminate : true, expected : 'status'});
	});
});
