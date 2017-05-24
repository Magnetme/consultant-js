import request from 'request';
import uuid from 'node-uuid';
import promisify from './promisify';
import ConsultantError from './consultant-error';
import properties from './properties';

const deregister = async (host, instance) => {
	const req = {
		url : `${host}/v1/agent/service/deregister/${instance.instance}`,
		method : 'DELETE',
		headers : {
			'user-agent' : properties.userAgent
		}
	};

	try {
		await promisify(cb => request(req, cb));
	}
	catch (e) {
		throw new ConsultantError(`Could not deregister from Consul: ${e}`);
	}
};

export default async function register({service : {port, name, dataCenter, host, instance}, healthCheckPath, healthCheckInterval = 10, consulHost}) {
	consulHost = consulHost || process.env.CONSUL_HOST || properties.defaultHost;

	if (!port) {
		throw new ConsultantError('port was not defined');
	}

	if (!name) {
		throw new ConsultantError('service.name was not defined');
	}

	let agent = null;
	try {
		const res = await promisify(cb => request({
			uri : `${consulHost}/v1/agent/self`,
			timeout : 5000,
			headers : {
				'user-agent' : properties.userAgent
			}
		}, cb));
		agent = JSON.parse(res.body);
	}
	catch (e) {
		throw new ConsultantError(`Could not retrieve agent from consul: ${e}`);
	}

	const identifier = {
		name : name || process.env.SERVICE_NAME,
		dataCenter : dataCenter || process.env.SERVICE_DC || agent.Config.Datacenter,
		host : host || process.env.SERVICE_HOST || agent.Config.NodeName,
		instance : instance || process.env.SERVICE_INSTANCE || uuid.v4()
	};

	const body = {
		Id : identifier.instance,
		Name : identifier.name,
		Address : identifier.host,
		Port : port,
	};

	if (healthCheckPath && healthCheckInterval > 0) {
		Object.assign(body, {
			Check : {
				HTTP : `http://${identifier.host}:${port}${healthCheckPath}`,
				Interval : healthCheckInterval
			}
		});
	}

	const req = {
		url : `${consulHost}/v1/agent/service/register`,
		method : 'PUT',
		headers : {
			'user-agent' : properties.userAgent
		},
		json : body
	};

	try {
		await promisify(cb => request(req, cb));
	}
	catch (e) {
		throw new ConsultantError('Could not register service with Consul', e);
	}

	return {
		identifier,
		deregister : () => deregister(consulHost, identifier)
	};
};
