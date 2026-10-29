'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {describe, it} = require('node:test');
const {service, config, health} = require('../out');

// Exercise the published client against real HTTP, without replacing fetch.
async function startConsul(test) {
	const state = {agentStatus : 200, writeStatus : 200, healthStatus : 200, services : [], writes : 0};
	const server = http.createServer((request, response) => {
		if (request.method === 'GET' && request.url === '/v1/agent/self') {
			response.writeHead(state.agentStatus, {'content-type' : 'application/json'});
			// A plausible body must never override an unsuccessful status.
			response.end(JSON.stringify({Config : {Datacenter : 'test', NodeName : 'localhost'}}));
			return;
		}
		if (request.method === 'GET' && request.url === '/v1/health/service/api?near=_agent&passing=true') {
			response.writeHead(state.healthStatus, {'content-type' : 'application/json'});
			response.end(JSON.stringify(state.services));
			return;
		}
		if (request.method === 'GET' && request.url === '/v1/kv/api/?recurse=true') {
			response.writeHead(200, {'content-type' : 'application/json'});
			response.end(JSON.stringify([{Key : 'api/message', Value : Buffer.from('hello').toString('base64')}]));
			return;
		}
		if (request.method === 'PUT' && ['/v1/agent/service/register', '/v1/agent/service/deregister/api-1'].includes(request.url)) {
			let body = '';
			request.on('data', chunk => { body += chunk; });
			request.on('end', () => {
				state.writes += 1;
				if (state.writeStatus >= 200 && state.writeStatus < 300) {
					state.services = request.url === '/v1/agent/service/register' ? [JSON.parse(body)] : [];
				}
				response.writeHead(state.writeStatus);
				response.end('synthetic rejected response');
			});
			return;
		}
		response.writeHead(404);
		response.end('unexpected fixture request');
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	test.after(() => new Promise(resolve => server.close(resolve)));
	const consulHost = `http://127.0.0.1:${server.address().port}`;
	return {
		state,
		args : {consulHost, service : {name : 'api', port : 3000, instance : 'api-1'}},
		healthArgs : {consulHost, service : 'api'}
	};
}

function rejectsWithStatus(status) {
	return error => {
		assert.equal(error.name, 'ConsultantError');
		assert.match(error.message, new RegExp(`status ${status}\\b`));
		assert.equal(error.message.includes('synthetic rejected response'), false);
		return true;
	};
}

describe('Consul HTTP response status', () => {
	for (const status of [200, 201, 204]) {
		it(`accepts successful ${status} registration and deregistration`, async test => {
			const {state, args, healthArgs} = await startConsul(test);
			state.writeStatus = status;
			const registration = await service(args);
			assert.equal(registration.identifier.instance, 'api-1');
			assert.deepEqual(await health(healthArgs), [{Id : 'api-1', Name : 'api', Address : 'localhost', Port : 3000}]);
			await registration.deregister();
			assert.deepEqual(await health(healthArgs), []);
		});
	}

	for (const status of [400, 401, 403, 404, 429, 500, 503]) {
		it(`rejects registration on HTTP ${status} and allows a later accepted registration`, async test => {
			const {state, args, healthArgs} = await startConsul(test);
			state.writeStatus = status;
			const outcome = service(args);
			await Promise.allSettled([outcome]);
			assert.equal(state.writes, 1);
			assert.deepEqual(await health(healthArgs), []);
			await assert.rejects(outcome, rejectsWithStatus(status));
			state.writeStatus = 200;
			const registration = await service(args);
			assert.equal((await health(healthArgs)).length, 1);
			await registration.deregister();
		});

		it(`rejects deregistration on HTTP ${status} and allows a later accepted deregistration`, async test => {
			const {state, args, healthArgs} = await startConsul(test);
			const registration = await service(args);
			state.writeStatus = status;
			const outcome = registration.deregister();
			await Promise.allSettled([outcome]);
			assert.equal(state.writes, 2);
			assert.equal((await health(healthArgs)).length, 1);
			await assert.rejects(outcome, rejectsWithStatus(status));
			state.writeStatus = 200;
			await registration.deregister();
			assert.deepEqual(await health(healthArgs), []);
		});
	}

	for (const status of [401, 403, 500]) {
		it(`rejects agent HTTP ${status} before registering despite a valid-looking JSON body`, async test => {
			const {state, args} = await startConsul(test);
			state.agentStatus = status;
			await assert.rejects(service(args), rejectsWithStatus(status));
			assert.equal(state.writes, 0);
		});

		it(`rejects configuration setup when agent HTTP ${status} has a valid-looking JSON body`, async test => {
			const {state, args} = await startConsul(test);
			state.agentStatus = status;
			await assert.rejects(config(args).then(configuration => {
				configuration.stop();
				return configuration;
			}), rejectsWithStatus(status));
		});

		it(`already rejects health HTTP ${status}`, async test => {
			const {state, healthArgs} = await startConsul(test);
			state.healthStatus = status;
			await assert.rejects(health(healthArgs), rejectsWithStatus(status));
		});
	}
});
