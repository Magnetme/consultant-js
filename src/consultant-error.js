class ConsultantError extends Error {
	constructor(message) {
		super(message);
		this.message = message;
		this.name = 'ConsultantError';
	}
}

export default ConsultantError;
