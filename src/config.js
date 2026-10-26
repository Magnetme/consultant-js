import fetch from 'node-fetch';
import props from './properties';
import fetchIdentifier from './identifier';
import {parseKey, keyApplies} from './key-parser';
import atob from 'atob';
import encodePathSegment from './path-segment';

const configUpdater = (consulHost, prefix, service, keyPath, callback) => {
	let consulIndex;
	let timeoutId;
	let shutdown = false;
	const self = {
		async poll() {
			let timeout = 500;
			try {
				let uri = `${consulHost}/v1/kv/${keyPath}/?recurse=true`;
				if (consulIndex) {
					uri += `&index=${consulIndex}`;
				}
				const response = await fetch(uri, {
					headers : {
						'accept' : 'application/json',
						'content-type' : 'application/json',
						'user-agent' : props.userAgent
					},
				});

				consulIndex = response.headers['x-consul-index'];
				if (response.status === 404) {
					response.body.resume();
					timeout = 5000;
					const prefixText = prefix ? ` with prefix '${prefix}'` : '';
					console.warn(`'${service.name}'${prefixText} cannot be found in Consul`);
					return;
				}
				if (response.status !== 200) {
					response.body.resume();
					timeout = 60000;
					console.warn(`Error retrieving data from Consul: HTTP ${response.status}`);
					return;
				}
				const json = await response.json();
				if (shutdown) {
					return;
				}
				const properties = parseBody(json, prefix, service);
				if (callback) {
					callback(properties);
				}
			}
			catch (e) {
				timeout = 5000;
				const reason = e && e.type === 'invalid-json' ? 'invalid JSON' : 'request or configuration processing failed';
				console.warn(`Error retrieving data from Consul: ${reason}`);
			}
			finally {
				if (!shutdown) {
					timeoutId = setTimeout(self.poll, timeout);
				}
			}
		},
		stop() {
			shutdown = true;
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}
	};

	return self;
};

// Define data properties so a Consul key never invokes an inherited setter.
function copyProperties(target, source) {
	Object.keys(source).forEach(key => {
		Object.defineProperty(target, key, {
			value : source[key],
			writable : true,
			enumerable : true,
			configurable : true
		});
	});
	return target;
}

/**
 * Parses the fetched config from Consul and converts it to a proper object.
 * @param body {Array} - The response body
 * @param prefix {string} - The prefix to extract from the key path
 * @param service {Object} - The service identifier to match key specifiers against
 * @return {Object} A properties object containing all valid properties as specified in the body
 */
function parseBody(body, prefix, service) {
	return body.map(kvPair => {
		return {key : parseKey(kvPair.Key, prefix), value : kvPair.Value};
	})
		.filter(kvPair => kvPair.key.key && keyApplies(kvPair.key, service))
		.map(kvPair => {
			return {[kvPair.key.key] : atob(kvPair.value)};
		})
		.reduce((properties, kvPair) => copyProperties(properties, kvPair), {});
}

const updateConfig = (properties, newConfig, callbacks) => {
	const updates = Object.keys(newConfig).filter(key => properties[key] !== newConfig[key]);

	copyProperties(properties, newConfig);

	const deletes = Object.keys(properties).filter(key => !Object.prototype.hasOwnProperty.call(newConfig, key));
	deletes.forEach(key => delete properties[key]);

	if (updates.length > 0 || deletes.length > 0) {
		callbacks.forEach(callback => callback(copyProperties({}, properties)));
	}
};

export default async function initializeConfiguration({consulHost, service, prefix}) {
	const callbacks = new Set();

	consulHost = consulHost || process.env.CONSUL_HOST || props.defaultHost;

	const prefixUri = prefix ? `${prefix.split('/').map(encodePathSegment).join('/')}/` : '';
	const keyPath = `${prefixUri}${encodePathSegment(service.name || process.env.SERVICE_NAME)}`;
	const identifier = await fetchIdentifier(service, consulHost);

	let liveProperties = {};

	const updater = configUpdater(consulHost, prefix, identifier, keyPath, (newProperties) => {
		updateConfig(liveProperties, newProperties, callbacks);
	});

	await updater.poll();

	return {
		getProperties() {
			return copyProperties({}, liveProperties);
		},
		register(callback) {
			callbacks.add(callback);
		},
		deregister(callback) {
			callbacks.delete(callback);
		},
		stop() {
			updater.stop();
		}
	};
}
