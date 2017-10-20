[![Magnet.me Logo](https://cdn.magnet.me/images/logo-2015-full.svg)](https://magnet.me?ref=github-consultant-js "Discover the best companies, jobs and internships at Magnet.me")

# Consultant
###### Fetches your service's configuration from Consul, and subscribes to any changes.

## Install

```js
npm install @magnet.me/consultant
```

## What's Consultant?
Consultant is a Node library which allows your service to retrieve its configuration from Consul's Key/Value store as well as registering services. In addition to this, Consultant subscribes to any changes relevant to your service.

## How to use Consultant?
Consultant consists of two separate functions, `service` and `config` which allow you to set up respectively the service registration and Key/Value configuration.

Both `service` and `config` require a single object parameter containing at least one `service` field, which acts as the service's identity. Using this identity the correct configuration can be fetched from Consul's Key/Value store. You must at the very least specify the service's name. You can also optionally specify the name of the data center where the service is running, the hostname of the machine the service is running on, and instance name to describe the role of this particular instance.

Alternatively you can also define this identity through environment variables:

| Environment variable | Corresponds to | Required |
|:---------------------|:---------------|:---------|
| SERVICE_NAME  | Name of the service | Yes |
| SERVICE_DC    | Name of the datacenter where the service is running | No |
| SERVICE_HOST  | The name of the host where this service is running on | No |
| SERVICE_INSTANCE | The name of this particular instance of the service | No |

### Specifying an alternative Consul address
Consultant defaults Consul's REST API address to `http://localhost:8500`. If you wish to specify an alternative address to Consul's REST API, you can do so by setting the `consulHost` field.

Or alternatively you can also define the this through an environment variable:

| Environment variable | Corresponds to |
|:---------------------|:---------------|
| CONSUL_HOST  | Address of Consul's REST API |

## Listening for config updates
`config` returns a promise which when resolved contains an object that allows consumers to register to updates in their configuration. This approach allows consumers to directly fetch the configuration, or subscribe to any changes made. For example:
```javascript
import {config} from '@magnet.me/consultant';

const {register, getProperties} = await config({service:{name:'test-server'}});

console.log(getProperties());

register(properties => console.log(properties));
```
