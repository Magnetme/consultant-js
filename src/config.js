import request from 'request';
import promisify from './promisify';
import ConsultantError from './consultant-error';
import properties from './properties';
import {parseKey, keyApplies} from './key-parser';
import atob from 'atob';

const loadConfig = async (consulHost, prefix, service) => {
	const prefixUri = prefix ? `${prefix}/` : '';
	const response = await promisify(cb => request({
		uri : `${consulHost}/v1/kv/${prefixUri}${service.name}/?recurse=false`,
		headers: {
			'user-agent': properties.userAgent
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
	return response.body
		.map(kvPair => {
			return {key : parseKey(kvPair.Key, prefix), value : kvPair.Value};
		})
		.filter(kvPair => kvPair.key.key && keyApplies(kvPair.key, service))
		.map(kvPair => {
			return {[kvPair.key.key] : atob(kvPair.value)};
		})
		.reduce((properties, kvPair) => Object.assign(properties, kvPair), {});
};

const updateConfig = (properties, newConfig, callbacks) => {
	const updates = Object.keys(newConfig).filter(key => properties[key] !== newConfig[key]);

	Object.assign(properties, newConfig);

	const deletes = Object.keys(properties).filter(key => !newConfig[key]);
	deletes.forEach(key => delete properties[key]);

	if (updates.length > 0 || deletes.length > 0) {
		callbacks.forEach(callback => callback(properties))
	}
};

export default async function ({consulHost, service, prefix, interval = 500}) {
	const callbacks = new Set();

	const host = consulHost || process.env.CONSUL_HOST || properties.defaultHost;

	service = {
		name : service.name || process.env.SERVICE_NAME,
		dataCenter : service.dataCenter || process.env.SERVICE_DC,
		host : service.host || process.env.SERVICE_HOST,
		instance : service.instance || process.env.SERVICE_INSTANCE
	};

	const initialProperties = await loadConfig(host, prefix, service);

	let timerId = 0;
	if (interval > 0) {
		timerId = setInterval(async () => await updateConfig(initialProperties, await loadConfig(host, prefix, service), callbacks), interval);
	}

	return {
		properties: initialProperties,
		register(callback) {
			callbacks.add(callback);
		},
		deregister(callback) {
			callbacks.delete(callback);
		},
		stop() {
			clearInterval(timerId);
		}
	}
}
