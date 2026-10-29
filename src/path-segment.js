import ConsultantError from './consultant-error';

export default function encodePathSegment(value) {
	const segment = String(value);
	// URL parsers normalize whole dot segments even when their dots are encoded.
	if (segment === '.' || segment === '..') {
		throw new ConsultantError('Consul path parameters must not be dot segments');
	}
	return encodeURIComponent(segment);
}
