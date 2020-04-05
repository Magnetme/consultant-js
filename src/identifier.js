import fetchAgent from './agent';
import { v4 as uuidv4 } from 'uuid';

export default async function loadIdentifier(identifier, consulHost) {
	const agent = await fetchAgent(consulHost);

	return {
		name : identifier.name || process.env.SERVICE_NAME,
		dataCenter : identifier.dataCenter || process.env.SERVICE_DC || agent.Config.Datacenter,
		host : identifier.host || process.env.SERVICE_HOST || agent.Config.NodeName,
		instance : identifier.instance || process.env.SERVICE_INSTANCE || uuidv4(),
	};
}
