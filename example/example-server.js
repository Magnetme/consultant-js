import express from 'express';
import instance, {init} from '../index';

const name = 'test-server';
const port = 10002;

const app = express();
let server = null;

app.get('/_health', (req, res) => {
	res.sendStatus(200);
});

init({service : {name, port}, healthCheckPath : '/_health', prefix: 'config'}).then(() => {

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
}).catch(async (e) => {
	console.error('Could not start server', e);
	await stop();
});

process.on('SIGINT', async () => {
	console.log('Caught interrupt signal. Stopping server.');

	await stop();

	process.exit();
});

async function stop() {
	try {
		console.log('deregistering from Consul');
		await instance.deregister();
		console.log('stopping server');
		if (server) {
			server.close();
		}
		console.log('stopping Consultant');
		await instance.stopConfigPolling();
	}
	catch (e) {
		console.log('Failed to close the server properly', e);
	}
}
