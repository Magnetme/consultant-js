const validSpecifiers = {dc : 'dataCenter', host : 'host', instance : 'instance'};

function parseKey(key, prefix) {
	let tail = key;
	if (prefix) {
		if (!key.startsWith(prefix + '/')) {
			return undefined;
		}
		tail = key.substring(prefix.length + 1);
	}

	if (tail.includes('/[')) {
		const specifierStart = tail.indexOf('/[');
		const serviceName = tail.substring(0, specifierStart);
		const specifierEnd = tail.indexOf(']');

		const specifiers = tail.substring(specifierStart + 2, specifierEnd).split(',')
			.map(specifier => specifier.split('='))
			.filter(kvArray => validSpecifiers.hasOwnProperty(kvArray[0]))
			.map(kvArray => {
				const key = validSpecifiers[kvArray[0]];
				return {[key] : kvArray[1]};
			});

		tail = tail.substring(specifierEnd + 1);

		return Object.assign({serviceName, key : tail}, ...specifiers);
	}
	else if (tail.includes('/')) {
		const serviceName = tail.substring(0, tail.indexOf('/'));
		tail = tail.substring(tail.indexOf('/') + 1);
		return {key : tail, serviceName};
	}
	else {
		return {key : '', serviceName : tail};
	}
}

function keyApplies(key, service) {
	return isSetAndEqual(key.name, service.name)
		&& isSetAndEqual(key.dataCenter, service.dataCenter)
		&& isSetAndEqual(key.host, service.host)
		&& isSetAndEqual(key.instance, service.instance);
}

function isSetAndEqual(keyField, serviceField) {
	return !keyField || keyField === serviceField;
}

export {parseKey, keyApplies};