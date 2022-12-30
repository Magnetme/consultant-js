declare module "@magnet.me/consultant" {

    type Properties = Record<string, string>;

	interface ServiceIdentifier {
		name: string;
		dataCenter: string;
		host: string;
		instance: string;
	}

	interface ServiceArguments {
		service: { name: string, port: number };
		healthCheckPath: string;
		healthCheckInterval?: number;
		consulHost?: string;
		prefix?: string;
	}

	interface Service {
		identifier: ServiceIdentifier;
		deregister: () => Promise<void>;
	}

	interface ConfigArguments {
		consulHost?: string;
		service: ServiceIdentifier;
		prefix?: string;
	}

	interface Config {
		getProperties(): Properties;
		register(callback: (Properties) => void): void;
		deregister(callback: (Properties) => void): void;
		stop(): void;
	}

	function service(args: ServiceArguments): Promise<Service>;
	function config(args: ConfigArguments): Promise<Config>;
}
