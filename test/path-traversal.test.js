'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {describe, it} = require('node:test');
const {config, health, service} = require('../out');

async function startConsul(test) {
	const requests = [];
	const instances = new Set(['victim']);
	const server = http.createServer((request, response) => {
		let body = '';
		request.on('data', chunk => { body += chunk; });
		request.on('end', () => {
			requests.push({method : request.method, url : request.url});
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/agent/self') {
				response.end(JSON.stringify({Config : {Datacenter : 'test', NodeName : 'localhost'}}));
			}
			else if (request.url === '/v1/agent/service/register') {
				instances.add(JSON.parse(body).Id);
				response.end('{}');
			}
			else if (request.url.startsWith('/v1/agent/service/deregister/')) {
				instances.delete(decodeURIComponent(request.url.slice('/v1/agent/service/deregister/'.length).split('?')[0]));
				response.end('{}');
			}
			else {
				response.end('[]');
			}
		});
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	test.after(() => new Promise(resolve => server.close(resolve)));
	return {consulHost : `http://127.0.0.1:${server.address().port}`, requests, instances};
}

describe('Consul URL path boundaries', () => {
	for (const [name, path] of [
		['api', 'api'],
		['../../agent/self', '..%2F..%2Fagent%2Fself'],
		['%2e%2e/%2e%2e/agent/self', '%252e%252e%2F%252e%252e%2Fagent%2Fself'],
		['api?dc=other#part', 'api%3Fdc%3Dother%23part'],
		['api\\..\\other', 'api%5C..%5Cother']
	]) {
		it(`keeps health name ${JSON.stringify(name)} literal`, async test => {
			const {consulHost, requests} = await startConsul(test);
			await health({consulHost, service : name});
			assert.deepEqual(requests, [{method : 'GET', url : `/v1/health/service/${path}?near=_agent&passing=true`}]);
		});
	}

	for (const [instance, path] of [
		['api-1', 'api-1'],
		['../deregister/victim', '..%2Fderegister%2Fvictim'],
		['%2e%2e/deregister/victim', '%252e%252e%2Fderegister%2Fvictim'],
		['victim#own', 'victim%23own'],
		['victim?dc=other', 'victim%3Fdc%3Dother'],
		['api\\..\\deregister\\victim', 'api%5C..%5Cderegister%5Cvictim']
	]) {
		it(`deregisters only the literal instance ${JSON.stringify(instance)}`, async test => {
			const {consulHost, requests, instances} = await startConsul(test);
			const registration = await service({consulHost, healthCheckInterval : 0, service : {name : 'api', port : 3000, instance}});
			assert.equal(instances.has(instance), true, 'registration must store the requested literal ID');
			await registration.deregister();
			assert.equal(instances.has('victim'), true, 'a separate service must remain registered');
			assert.equal(instances.has(instance), false, 'the requested service must be removed');
			assert.deepEqual(requests[2], {method : 'PUT', url : `/v1/agent/service/deregister/${path}`});
		});
	}

	for (const [prefix, name, path] of [
		[undefined, 'api', 'api'],
		['apps/team', 'api', 'apps/team/api'],
		['apps', '../../agent/self', 'apps/..%2F..%2Fagent%2Fself'],
		['apps', '%2e%2e/other', 'apps/%252e%252e%2Fother'],
		['apps/team?dc=other#part', 'api', 'apps/team%3Fdc%3Dother%23part/api'],
		['apps', 'api?dc=other#part', 'apps/api%3Fdc%3Dother%23part'],
		['apps\\..\\other', 'api', 'apps%5C..%5Cother/api']
	]) {
		it(`keeps config prefix and name ${JSON.stringify([prefix, name])} literal`, async test => {
			const {consulHost, requests} = await startConsul(test);
			const configuration = await config({consulHost, prefix, service : {name, instance : 'test'}});
			test.after(() => configuration.stop());
			assert.deepEqual(configuration.getProperties(), {});
			assert.deepEqual(requests[1], {method : 'GET', url : `/v1/kv/${path}/?recurse=true`});
		});
	}

	for (const name of ['.', '..']) {
		it(`rejects health dot segment ${name} before sending a request`, async test => {
			const {consulHost, requests} = await startConsul(test);
			await assert.rejects(health({consulHost, service : name}), {name : 'ConsultantError'});
			assert.deepEqual(requests, []);
		});
	}

	for (const [prefix, name] of [['apps', '..'], ['apps/../other', 'api'], ['apps/./team', 'api']]) {
		it(`rejects config dot segments ${JSON.stringify([prefix, name])} before sending a request`, async test => {
			const {consulHost, requests} = await startConsul(test);
			let configuration;
			test.after(() => { if (configuration) { configuration.stop(); } });
			await assert.rejects(async () => {
				configuration = await config({consulHost, prefix, service : {name, instance : 'test'}});
			}, {name : 'ConsultantError'});
			assert.deepEqual(requests, []);
		});
	}

	for (const instance of ['.', '..']) {
		it(`rejects deregistration dot segment ${instance} without sending a PUT`, async test => {
			const {consulHost, requests} = await startConsul(test);
			const registration = await service({consulHost, healthCheckInterval : 0, service : {name : 'api', port : 3000, instance}});
			requests.length = 0;
			await assert.rejects(registration.deregister(), {name : 'ConsultantError'});
			assert.deepEqual(requests, []);
		});
	}
});
