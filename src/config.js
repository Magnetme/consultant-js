import fetch from 'node-fetch';
import props from './properties';
import fetchIdentifier from './identifier';
import {parseKey, keyApplies} from './key-parser';
import atob from 'atob';

const configUpdater = (consulHost, prefix, service, callback) => {
	let consulIndex;
	let timeoutId;
	let shutdown = false;
	const self = {
		async poll() {
			let timeout = 500;
			try {
				const prefixUri = prefix ? `${prefix}/` : '';
				let uri = `${consulHost}/v1/kv/${prefixUri}${service.name}/?recurse=true`;
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
					timeout = 5000;
					const prefixText = prefix ? ` with prefix '${prefix}'` : '';
					// eslint-disable-next-line no-console
					console.warn(`'${service.name}'${prefixText} cannot be found in Consul`);
					return;
				}
				if (response.status !== 200) {
					timeout = 60000;
					// eslint-disable-next-line no-console
					console.warn(`Error retrieving data from Consul: ${response.status}: ${await response.text()}`);
					return;
				}
				const json = await response.json();
				const properties = parseBody(json, prefix, service);
				if (callback) {
					callback(properties);
				}
			}
			catch (e) {
				timeout = 5000;
				// eslint-disable-next-line no-console
				console.warn(`Error retrieving data from Consul: ${e}`);
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
		.reduce((properties, kvPair) => Object.assign(properties, kvPair), {});
}

const updateConfig = (properties, newConfig, callbacks) => {
	const updates = Object.keys(newConfig).filter(key => properties[key] !== newConfig[key]);

	Object.assign(properties, newConfig);

	const deletes = Object.keys(properties).filter(key => !newConfig[key]);
	deletes.forEach(key => delete properties[key]);

	if (updates.length > 0 || deletes.length > 0) {
		callbacks.forEach(callback => callback(Object.assign({}, properties)));
	}
};

export default async function initializeConfiguration({consulHost, service, prefix}) {
	const callbacks = new Set();

	consulHost = consulHost || process.env.CONSUL_HOST || props.defaultHost;

	const identifier = await fetchIdentifier(service, consulHost);

	let liveProperties = {};

	const updater = configUpdater(consulHost, prefix, identifier, (newProperties) => {
		updateConfig(liveProperties, newProperties, callbacks);
	});

	await updater.poll();

	return {
		getProperties() {
			return Object.assign({}, liveProperties);
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
