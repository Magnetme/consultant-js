import request from 'request';
import properties from './properties';
import promisify from './promisify';
import ConsultantError from './consultant-error';

export default async function fetchAgent(consulHost) {
	try {
		const res = await promisify(cb => request({
			uri : `${consulHost}/v1/agent/self`,
			timeout : 5000,
			headers : {
				'user-agent' : properties.userAgent
			}
		}, cb));
		return JSON.parse(res.body);
	}
	catch (e) {
		throw new ConsultantError(`Could not retrieve agent from consul: ${e}`);
	}
}
