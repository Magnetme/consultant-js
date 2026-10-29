'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {it} = require('node:test');
const {config} = require('../out');

const encode = value => Buffer.from(value).toString('base64');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

async function startConfiguration(test, values) {
	const server = http.createServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify(request.url === '/v1/agent/self'
			? {Config : {Datacenter : 'test', NodeName : 'localhost'}}
			: values().map(([key, value]) => ({Key : `apps/api/${key}`, Value : encode(value)}))));
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	test.after(() => new Promise(resolve => server.close(resolve)));
	const configuration = await config({
		consulHost : `http://127.0.0.1:${server.address().port}`,
		prefix : 'apps',
		service : {name : 'api', instance : 'api-1'}
	});
	test.after(() => configuration.stop());
	return configuration;
}

async function nextUpdate(configuration) {
	return new Promise((resolve, reject) => {
		const callback = properties => {
			clearTimeout(timeout);
			configuration.deregister(callback);
			resolve(properties);
		};
		const timeout = setTimeout(() => {
			configuration.deregister(callback);
			reject(new Error('No configuration update within 3 seconds'));
		}, 3000);
		configuration.register(callback);
	});
}

it('preserves __proto__ as an own string property in snapshots and updates', async test => {
	const originalPrototype = Object.getOwnPropertyDescriptors(Object.prototype);
	let value = '{"polluted":"initial"}';
	const configuration = await startConfiguration(test, () => [
		['__proto__', value], ['normal', 'hello'], ['[dc=test]scoped', 'matching']
	]);
	const initial = configuration.getProperties();
	assert.equal(initial.normal, 'hello');
	assert.equal(initial.scoped, 'matching');
	assert.equal(Object.getPrototypeOf(initial), Object.prototype);
	assert.equal(own(initial, '__proto__'), true);
	assert.equal(initial.__proto__, '{"polluted":"initial"}');

	value = '{"polluted":"updated"}';
	const updated = await nextUpdate(configuration);
	assert.equal(own(updated, '__proto__'), true);
	assert.equal(updated.__proto__, '{"polluted":"updated"}');
	assert.equal(Object.getPrototypeOf(updated), Object.prototype);
	updated.__proto__ = 'caller mutation';
	assert.equal(configuration.getProperties().__proto__, '{"polluted":"updated"}');
	assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), originalPrototype);
	assert.equal(({}).polluted, undefined);
});

it('removes prototype-named configuration keys when Consul removes them', async test => {
	const keys = ['constructor', 'toString', 'hasOwnProperty', '__defineGetter__', '__defineSetter__'];
	let removed = false;
	const configuration = await startConfiguration(test, () => [
		...(removed ? [] : keys.map(key => [key, 'previous'])),
		['normal', removed ? 'updated' : 'hello'],
		...(removed ? [] : [['ordinary-removed', 'temporary']])
	]);
	const initial = configuration.getProperties();
	for (const key of keys) {
		assert.equal(own(initial, key), true);
		assert.equal(initial[key], 'previous');
	}
	assert.equal(initial['ordinary-removed'], 'temporary');
	removed = true;
	const updated = await nextUpdate(configuration);
	assert.equal(updated.normal, 'updated');
	assert.equal(own(updated, 'ordinary-removed'), false);
	for (const key of keys) assert.equal(own(updated, key), false, key);
	assert.deepEqual(configuration.getProperties(), {normal : 'updated'});
	assert.equal(Object.getPrototypeOf(updated), Object.prototype);
});
