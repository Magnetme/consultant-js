import fetch from 'node-fetch';
import properties from './properties';
import ConsultantError from './consultant-error';

export default async function fetchAgent(consulHost) {
	const uri = `${consulHost}/v1/agent/self`;
	try {
		const res = await fetch(uri, {
			timeout : 5000,
			headers : {
				'accept' : 'application/json',
				'content-type' : 'application/json',
				'user-agent' : properties.userAgent
			}
		});
		return await res.json();
	}
	catch (e) {
		throw new ConsultantError(`Could not retrieve agent from consul: ${e}`);
	}
}
