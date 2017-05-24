import service from './service';
import config from './config';

export {
	/**
	 * Registers a service with Consul
	 * @function
	 * @param {Object} configuration
	 * @param {Object} configuration.service - The service specific configuration
	 * @param {string} configuration.service.name - The name of the service (Used in both the registration and config retrieving)
	 * @param {Number} configuration.service.port - The port on which this service runs
	 * @param {string} [configuration.service.dataCenter] - The data center the service resides in
	 * @param {string} [configuration.service.host] - The host where Consul can find the service
	 * @param {string} [configuration.service.instance] - The instance identifier of the service
	 * @param {string} [configuration.healthCheckPath] - An optional http path where the health check can be found
	 * @param {Number} [configuration.healthCheckInterval] - The interval (in seconds) at which the health check is polled. If 0 no health check is done
	 * @param {string} [configuration.consulHost] - Where Consultant can find a Consul agent
	 * @return {Object} An object containing the identifier as well as a deregister function
	 * @return {Object} identifier - The specified service identifier
	 * @return {function} deregister - Function to deregister the service with its health check from Consul
	 */
	service,
	/**
	 * Set up the key/value retrieval and polling
	 * @function
	 * @param {Object} configuration
	 * @param {Object} configuration.service The service identifier used to validate properties against
	 * @param {string} configuration.service.name - The name of the service (Used in both the registration and config retrieving)
	 * @param {string} [configuration.service.dataCenter] - The data center the service resides in
	 * @param {string} [configuration.service.host] - The host where Consul can find the service
	 * @param {string} [configuration.service.instance] - The instance identifier of the service
	 * @param {string} [configuration.prefix] - The prefix path that should be before the service name in the key/value store
	 * @param {Number} [configuration.interval] - The interval (in milliseconds) at which to poll the store. If set to 0, no polling will be done
	 * @return {Object}
	 * @return {Object} properties - Object reflecting all the matching properties found by Consultant
	 * @return {function} register - Register a callback that receives the latest properties object any time a change is detected
	 * @return {function} deregister - Remove a registered callback
	 * @return {function} stop - Stop the store polling
	 */
	config
};
