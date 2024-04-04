// TODO you will need to install express manually as it's not part of the dependencies as defined in package.json
import express from 'express';
import {service, config} from '../src/index';

const name = 'test-server';
const port = 10002;

const app = express();
let server = null;

app.get('/_health', (req, res) => {
	res.sendStatus(200);
});

const init = async (configuration) => {
	const {identifier, deregister} = await service(configuration);

	const instance = Object.assign({}, {identifier, deregister});

	let getProperties;
	let registerConfigCallback;
	let deregisterConfigCallback;
	let stopConfigPolling;

	try {
		const conf = await config(Object.assign({}, configuration, {service : identifier}));
		getProperties = conf.getProperties;
		registerConfigCallback = conf.register;
		deregisterConfigCallback = conf.deregister;
		stopConfigPolling = conf.stop;
	}
	catch (e) {
		await stop(instance);

		throw new Error(e);
	}

	Object.assign(instance, {
		getProperties,
		registerConfigCallback,
		deregisterConfigCallback,
		stopConfigPolling
	});

	return instance;
};

init({service : {name, port}, healthCheckPath : '/_health', prefix : 'config'}).then(instance => {

	instance.registerConfigCallback((properties) => console.log(properties));

	server = app.listen(port, () => {
		const host = server.address().address;

		console.log('Broker listening at http://%s:%s', host, port);
	});

	server.on('error', async (e) => {
		if (e.code === 'EADDRINUSE') {
			console.error('Address http://localhost:%s in use!', port);
		}
		else {
			console.error(`Something broke! Failed to start listening. Error was ${e}`);
		}

		await stop();
	});

	process.on('SIGINT', async () => {
		console.log('Caught interrupt signal. Stopping server.');

		await stop(instance);

		process.exit();
	});

}).catch(async (e) => {
	console.error('Could not start server', e);
});

async function stop(instance) {
	try {
		console.log('deregistering from Consul');
		await instance.deregister();
		console.log('stopping server');
		if (server) {
			server.close();
		}
		if (instance.stopConfigPolling) {
			console.log('stopping Consultant');
			await instance.stopConfigPolling();
		}
	}
	catch (e) {
		console.log('Failed to close the server properly', e);
	}
}
