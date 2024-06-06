import fetch from 'node-fetch';
import props from './properties';
import properties from './properties';
import ConsultantError from './consultant-error';

export default async function health({ service, consulHost }) {
	consulHost = consulHost || process.env.CONSUL_HOST || props.defaultHost;
	const uri = `${consulHost}/v1/health/service/${service}?near=_agent&passing=true`;

	let result;
	try {
		result = await fetch(uri, {
			method : 'GET',
			headers : {
				'user-agent' : properties.userAgent
			}
		});
	}
	catch (e) {
		throw new ConsultantError(`Could not get health for ${service}: ${e}`);
	}

	if (result.ok) {
		return result.json();
	}
	const body = result.text();
	throw new ConsultantError(`Could not get health for ${service}: ${body} (status ${result.status})`);
}