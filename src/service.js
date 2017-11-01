import request from 'request';
import promisify from './promisify';
import ConsultantError from './consultant-error';
import properties from './properties';
import fetchIdentifier from './identifier';

const deregister = async (host, instance) => {
	const req = {
		url : `${host}/v1/agent/service/deregister/${instance.instance}`,
		method : 'PUT',
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

export default async function register({service, healthCheckPath, healthCheckInterval = 10, consulHost}) {
	consulHost = consulHost || process.env.CONSUL_HOST || properties.defaultHost;

	const portNumber = Number(service.port);
	if (!(portNumber > 0 && portNumber < 65536)) {
		throw new ConsultantError(`service.port=${service.port} is not a proper port`);
	}

	if (!service.name) {
		throw new ConsultantError('service.name was not defined');
	}

	const identifier = await fetchIdentifier(service, consulHost);

	const body = {
		Id : identifier.instance,
		Name : identifier.name,
		Address : identifier.host,
		Port : service.port,
	};

	if (healthCheckPath && healthCheckInterval > 0) {
		Object.assign(body, {
			Check : {
				HTTP : `http://${identifier.host}:${service.port}${healthCheckPath}`,
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
}
