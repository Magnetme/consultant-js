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
		const specifiersPart = tail.substring(specifierStart + 2, specifierEnd);

		const specifiers = extractSpecifiers(specifiersPart);

		tail = tail.substring(specifierEnd + 1);

		return Object.assign({name : serviceName, key : tail}, ...specifiers);
	}
	else if (tail.includes('/')) {
		const serviceName = tail.substring(0, tail.indexOf('/'));
		tail = tail.substring(tail.indexOf('/') + 1);
		return {key : tail, name : serviceName};
	}
	else {
		return {key : '', name : tail};
	}
}

/**
 * Splits up the specifier string into an array of specifier objects
 * @param {string} specifiersPart - A string of the following expected format: [spec1=val1,spec2=val2,...]
 * @return {Array} An array of specifiers in the following format [{dataCenter:'development'},{host:'localhost'},...]
 */
function extractSpecifiers(specifiersPart) {
	return specifiersPart.split(',')
			.map(specifier => specifier.split('='))
			.filter(kvArray => validSpecifiers.hasOwnProperty(kvArray[0]))
			.map(kvArray => {
				const key = validSpecifiers[kvArray[0]];
				return {[key] : kvArray[1]};
			});
}

function keyApplies(key, service) {
	return isUnsetOrEqual(key.name, service.name)
		&& isUnsetOrEqual(key.dataCenter, service.dataCenter)
		&& isUnsetOrEqual(key.host, service.host)
		&& isUnsetOrEqual(key.instance, service.instance);
}

function isUnsetOrEqual(keyField, serviceField) {
	return !keyField || keyField === serviceField;
}

export {parseKey, keyApplies};