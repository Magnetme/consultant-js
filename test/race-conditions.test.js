'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {setTimeout : delay} = require('node:timers/promises');
const {describe, it} = require('node:test');
const {config} = require('../out');

const body = value => JSON.stringify([
	{Key : 'apps/api/security-mode', Value : Buffer.from(value).toString('base64')}
]);

function sendJson(response, value) {
	response.writeHead(200, {'content-type' : 'application/json'});
	response.end(value);
}

async function startConsul(test, handler) {
	const server = http.createServer((request, response) => {
		if (request.url === '/v1/agent/self') {
			sendJson(response, JSON.stringify({Config : {Datacenter : 'test', NodeName : 'localhost'}}));
			return;
		}
		handler(request, response);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	test.after(() => new Promise(resolve => {
		server.closeAllConnections();
		server.close(resolve);
	}));
	return `http://127.0.0.1:${server.address().port}`;
}

describe('configuration shutdown races', () => {
	for (const partialBody of [false, true]) {
		const phase = partialBody ? 'during a response body' : 'before response headers';
		it(`ignores an in-flight update stopped ${phase}`, {timeout : 6000}, async test => {
			let requests = 0;
			let holdResponse;
			const pendingResponse = new Promise(resolve => { holdResponse = resolve; });
			const consulHost = await startConsul(test, (request, response) => {
				requests += 1;
				if (requests < 3) {
					sendJson(response, body(requests === 1 ? 'initial' : 'enforced'));
					return;
				}
				if (partialBody) {
					response.writeHead(200, {'content-type' : 'application/json'});
					response.write('[');
				}
				holdResponse(response);
			});
			const configuration = await config({consulHost, prefix : 'apps', service : {name : 'api'}});
			test.after(() => configuration.stop());
			assert.deepEqual(configuration.getProperties(), {'security-mode' : 'initial'});

			const notifications = [];
			const removedNotifications = [];
			const removed = properties => removedNotifications.push(properties);
			configuration.register(removed);
			configuration.deregister(removed);
			let notify;
			const liveUpdate = new Promise(resolve => { notify = resolve; });
			configuration.register(properties => {
				notifications.push(properties);
				notify();
			});
			await liveUpdate;
			assert.deepEqual(configuration.getProperties(), {'security-mode' : 'enforced'});
			assert.deepEqual(notifications, [{'security-mode' : 'enforced'}]);
			assert.deepEqual(removedNotifications, []);

			const response = await pendingResponse;
			configuration.stop();
			configuration.stop();
			if (partialBody) {
				response.end(body('disabled').slice(1));
			}
			else {
				sendJson(response, body('disabled'));
			}
			// Allow the real HTTP response and a full polling interval to complete.
			await delay(750);
			assert.deepEqual({
				properties : configuration.getProperties(),
				notifications,
				removedNotifications,
				requests
			}, {
				properties : {'security-mode' : 'enforced'},
				notifications : [{'security-mode' : 'enforced'}],
				removedNotifications : [],
				requests : 3
			});
		});
	}

	it('cancels a scheduled poll when stopped before it starts', {timeout : 3000}, async test => {
		let requests = 0;
		const consulHost = await startConsul(test, (request, response) => {
			requests += 1;
			sendJson(response, body('enforced'));
		});
		const configuration = await config({consulHost, prefix : 'apps', service : {name : 'api'}});
		test.after(() => configuration.stop());
		configuration.stop();
		configuration.stop();
		await delay(750);
		assert.equal(requests, 1);
		assert.deepEqual(configuration.getProperties(), {'security-mode' : 'enforced'});
	});
});
