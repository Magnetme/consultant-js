export default function promisify(func) {
	return new Promise((resolve, reject) => {
		func((err, res) => {
			if (err) {
				reject(err);
			} else {
				resolve(res);
			}
		});
	});
}
