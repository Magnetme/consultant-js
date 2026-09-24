'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {describe, it} = require('node:test');

const {config, service} = require('../out');
const {keyApplies, parseKey} = require('../out/key-parser');

const encode = value => Buffer.from(value).toString('base64');

async function startConsul(test, handler) {
	const server = http.createServer(handler);
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	test.after(() => new Promise(resolve => server.close(resolve)));
	return `http://127.0.0.1:${server.address().port}`;
}

function sendJson(response, body) {
	response.writeHead(200, {'content-type' : 'application/json'});
	response.end(JSON.stringify(body));
}

describe('configuration', () => {
	it('parses keys and matches service identifiers', () => {
		assert.deepEqual(parseKey('apps/api/property', 'apps'), {
			key : 'property',
			name : 'api'
		});
		assert.equal(parseKey('other/api/property', 'apps'), undefined);
		assert.equal(keyApplies({name : 'api', dataCenter : 'test'}, {
			name : 'api',
			dataCenter : 'test'
		}), true);
		assert.equal(keyApplies({name : 'api', dataCenter : 'production'}, {
			name : 'api',
			dataCenter : 'test'
		}), false);
	});

	it('loads properties and publishes updates from Consul', async test => {
		let configRequest = 0;
		const consulHost = await startConsul(test, (request, response) => {
			if (request.url === '/v1/agent/self') {
				sendJson(response, {Config : {Datacenter : 'test', NodeName : 'localhost'}});
				return;
			}

			configRequest += 1;
			const values = configRequest === 1
				? [
					{Key : 'apps/api/message', Value : encode('hello')},
					{Key : 'apps/api/remove-me', Value : encode('temporary')},
					{Key : 'apps/other/ignored', Value : encode('not for api')}
				]
				: [
					{Key : 'apps/api/message', Value : encode('updated')},
					{Key : 'apps/api/added', Value : encode('new')}
				];
			sendJson(response, values);
		});

		const configuration = await config({
			consulHost,
			prefix : 'apps',
			service : {name : 'api', instance : 'api-1'}
		});
		test.after(() => configuration.stop());

		assert.deepEqual(configuration.getProperties(), {
			message : 'hello',
			'remove-me' : 'temporary'
		});

		const updatedProperties = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Timed out waiting for configuration update')), 2000);
			configuration.register(properties => {
				clearTimeout(timeout);
				resolve(properties);
			});
		});

		assert.deepEqual(updatedProperties, {message : 'updated', added : 'new'});
		assert.deepEqual(configuration.getProperties(), updatedProperties);
	});
});

describe('service registration', () => {
	it('registers and deregisters a service with Consul', async test => {
		const requests = [];
		const consulHost = await startConsul(test, (request, response) => {
			if (request.url === '/v1/agent/self') {
				sendJson(response, {Config : {Datacenter : 'test', NodeName : 'localhost'}});
				return;
			}

			let body = '';
			request.on('data', chunk => {
				body += chunk;
			});
			request.on('end', () => {
				requests.push({body, method : request.method, url : request.url});
				response.writeHead(200);
				response.end();
			});
		});

		const registration = await service({
			consulHost,
			healthCheckInterval : 15,
			healthCheckPath : '/health',
			service : {name : 'api', port : 3000, instance : 'api-1'}
		});

		assert.deepEqual(registration.identifier, {
			name : 'api',
			dataCenter : 'test',
			host : 'localhost',
			instance : 'api-1'
		});
		assert.equal(requests[0].method, 'PUT');
		assert.equal(requests[0].url, '/v1/agent/service/register');
		assert.deepEqual(JSON.parse(requests[0].body), {
			Id : 'api-1',
			Name : 'api',
			Address : 'localhost',
			Port : 3000,
			Check : {HTTP : 'http://localhost:3000/health', Interval : '15s'}
		});

		await registration.deregister();
		assert.equal(requests[1].method, 'PUT');
		assert.equal(requests[1].url, '/v1/agent/service/deregister/api-1');
	});
});
