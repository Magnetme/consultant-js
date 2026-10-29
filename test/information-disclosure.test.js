'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {describe, it} = require('node:test');

const {config} = require('../out');

const encode = value => Buffer.from(value).toString('base64');

async function startConsul(test, handler) {
	const requests = [];
	const server = http.createServer((request, response) => {
		requests.push(request.url);
		if (request.url === '/v1/agent/self') {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({Config : {Datacenter : 'test', NodeName : 'localhost'}}));
			return;
		}
		handler(request, response);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	test.after(() => new Promise(resolve => {
		server.close(resolve);
		server.closeAllConnections();
	}));
	return {consulHost : `http://127.0.0.1:${server.address().port}`, requests};
}

async function loadConfig(test, consulHost) {
	const configuration = await config({consulHost, service : {name : 'api', instance : 'api-1'}});
	test.after(() => configuration.stop());
	return configuration;
}

describe('configuration warning confidentiality', () => {
	for (const status of [403, 404, 500]) {
		it(`closes a streaming HTTP ${status} response without logging its body`, async test => {
			const warnings = [];
			test.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
			let onClose;
			const responseClosed = new Promise(resolve => { onClose = resolve; });
			const fixture = await startConsul(test, (request, response) => {
				response.on('close', () => onClose(true));
				response.writeHead(status);
				const chunk = 'synthetic-upstream-password-06'.repeat(8192);
				let chunksRemaining = 64;
				const writeChunks = () => {
					while (chunksRemaining > 0) {
						chunksRemaining -= 1;
						if (!response.write(chunk)) {
							response.once('drain', writeChunks);
							return;
						}
					}
					response.end();
				};
				writeChunks();
			});
			const configuration = await loadConfig(test, fixture.consulHost);
			configuration.stop();
			let timeout;
			const deadline = new Promise(resolve => { timeout = setTimeout(() => resolve(false), 1000); });
			test.after(() => clearTimeout(timeout));
			assert.equal(await Promise.race([responseClosed, deadline]), true, 'rejected response connection should close');
			assert.deepEqual(configuration.getProperties(), {});
			assert.equal(warnings.length, 1);
			assert.doesNotMatch(warnings[0], /synthetic-upstream-password-06/);
		});
	}

	for (const status of [403, 500]) {
		it(`keeps HTTP ${status} diagnostics without logging the response body`, async test => {
			const warnings = [];
			test.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
			const fixture = await startConsul(test, (request, response) => {
				response.writeHead(status);
				response.end('synthetic-upstream-password-06');
			});
			const configuration = await loadConfig(test, fixture.consulHost);
			assert.deepEqual(fixture.requests, ['/v1/agent/self', '/v1/kv/api/?recurse=true']);
			assert.deepEqual(configuration.getProperties(), {});
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], new RegExp(`Consul.*${status}`));
			assert.doesNotMatch(warnings[0], /synthetic-upstream-password-06/);
		});
	}

	for (const failure of ['invalid JSON', 'connection reset']) {
		it(`does not log URL credentials when polling encounters ${failure}`, async test => {
			const warnings = [];
			test.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
			const fixture = await startConsul(test, (request, response) => {
				if (failure === 'connection reset') {
					request.socket.destroy();
					return;
				}
				response.end('{synthetic-private-config-06');
			});
			const consulHost = fixture.consulHost.replace('http://', 'http://synthetic-user-06:synthetic-url-password-06@');
			const configuration = await loadConfig(test, consulHost);
			assert.deepEqual(fixture.requests, ['/v1/agent/self', '/v1/kv/api/?recurse=true']);
			assert.deepEqual(configuration.getProperties(), {});
			assert.equal(warnings.length, 1);
			assert.match(warnings[0], /Consul/);
			assert.doesNotMatch(warnings[0], /synthetic-user-06|synthetic-url-password-06|synthetic-private-config-06/);
		});
	}

	it('delivers updated secrets to subscribers without logging a thrown callback message', async test => {
		const warnings = [];
		let onWarning;
		const warningReceived = new Promise(resolve => { onWarning = resolve; });
		test.mock.method(console, 'warn', (...args) => {
			warnings.push(args.join(' '));
			onWarning();
		});
		let polls = 0;
		const fixture = await startConsul(test, (request, response) => {
			polls += 1;
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify([
				{Key : 'api/password', Value : encode(polls === 1 ? 'synthetic-initial-06' : 'synthetic-updated-06')},
				{Key : 'other/password', Value : encode('synthetic-other-service-06')},
				{Key : 'api/[dc=other]password', Value : encode('synthetic-other-dc-06')}
			]));
		});
		const configuration = await loadConfig(test, fixture.consulHost);
		assert.deepEqual(configuration.getProperties(), {password : 'synthetic-initial-06'});
		assert.deepEqual(warnings, []);
		let delivered;
		configuration.register(properties => {
			delivered = properties;
			throw new Error(`callback failed with ${properties.password}`);
		});
		const timeout = setTimeout(() => onWarning(), 2000);
		test.after(() => clearTimeout(timeout));
		await warningReceived;
		configuration.stop();
		assert.deepEqual(delivered, {password : 'synthetic-updated-06'});
		assert.deepEqual(configuration.getProperties(), delivered);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /Consul/);
		assert.doesNotMatch(warnings[0], /synthetic-updated-06|callback failed/);
	});

	it('returns successful secret values without automatically warning', async test => {
		const warnings = [];
		test.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
		const fixture = await startConsul(test, (request, response) => {
			response.end(JSON.stringify([{Key : 'api/password', Value : encode('synthetic-authorized-06')}]));
		});
		const configuration = await loadConfig(test, fixture.consulHost);
		configuration.stop();
		assert.deepEqual(configuration.getProperties(), {password : 'synthetic-authorized-06'});
		assert.deepEqual(warnings, []);
	});
});
