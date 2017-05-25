import request from 'request';
import promisify from './promisify';
import ConsultantError from './consultant-error';
import properties from './properties';
import fetchIdentifier from './identifier';
import {parseKey, keyApplies} from './key-parser';
import atob from 'atob';

const loadConfig = async (consulHost, prefix, service) => {
	const prefixUri = prefix ? `${prefix}/` : '';
	const response = await promisify(cb => request({
		uri : `${consulHost}/v1/kv/${prefixUri}${service.name}/?recurse=false`,
		headers : {
			'user-agent' : properties.userAgent
		},
		json : true
	}, cb));

	if (response.statusCode === 404) {
		const prefixText = prefix ? ` with prefix '${prefix}'` : '';
		throw new ConsultantError(`'${service.name}'${prefixText} cannot be found in Consul`);
	}
	if (response.statusCode !== 200) {
		throw new ConsultantError(`Error retrieving data from Consul: ${response.statusCode}: ${response.body}`);
	}
	return parseBody(response.body, prefix, service);
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

export default async function initializeConfiguration({consulHost, service, prefix, interval = 500}) {
	const callbacks = new Set();

	consulHost = consulHost || process.env.CONSUL_HOST || properties.defaultHost;

	const identifier = await fetchIdentifier(service, consulHost);

	const liveProperties = await loadConfig(consulHost, prefix, identifier);

	let timerId;
	if (interval > 0) {
		timerId = setInterval(async () => {
			const newProperties = await loadConfig(consulHost, prefix, identifier);
			updateConfig(liveProperties, newProperties, callbacks);
		}, interval);
	}

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
			if (timerId) {
				clearInterval(timerId);
			}
		}
	};
}
