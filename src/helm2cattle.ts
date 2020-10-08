import * as k8s from '@kubernetes/client-node';
import Operator, {
  ResourceEvent,
  ResourceEventType
} from '@dot-i/k8s-operator';
import ora from 'ora';
import Logger from './logger';
import { Config } from './config';
import { CustomResourceLookup, ResourcesLookup } from './types';

export default class Helm2CattleOperator extends Operator {
  objectApi: k8s.KubernetesObjectApi;

  customObjectsApi: k8s.CustomObjectsApi;

  appsV1Api: k8s.AppsV1Api;

  networkingV1betaApi: k8s.NetworkingV1beta1Api;

  labelNamespace = 'dev.siliconhills.helm2cattle';

  spinner = ora();

  group = 'helm.fluxcd.io';

  kind = 'HelmRelease';

  plural = 'helmreleases';

  version = 'v1';

  static customResourcesLookup: CustomResourceLookup[] = [];

  static resourcesLookup: ResourcesLookup = {
    ConfigMap: 'k8sApi',
    ControllerRevision: 'appsV1Api',
    Deployment: 'appsV1Api',
    Ingress: 'networkingV1betaApi',
    PersistentVolumeClaim: 'k8sApi',
    Pod: 'k8sApi',
    ReplicaSet: 'appsV1Api',
    Secret: 'k8sApi',
    Service: 'k8sApi',
    StatefulSet: 'appsV1Api'
  };

  constructor(protected config: Config, protected log = new Logger()) {
    super(log);
    this.objectApi = k8s.KubernetesObjectApi.makeApiClient(this.kubeConfig);
    this.customObjectsApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi);
    this.appsV1Api = this.kubeConfig.makeApiClient(k8s.AppsV1Api);
    this.networkingV1betaApi = this.kubeConfig.makeApiClient(
      k8s.NetworkingV1beta1Api
    );
  }

  protected async init() {
    await this.watchResource(
      this.group,
      this.version,
      this.plural,
      async (e) => {
        try {
          if (
            e.type !== ResourceEventType.Added &&
            e.type !== ResourceEventType.Modified
          ) {
            return;
          }
          const resources = await this.getResources(e);
          const appId = e.object.metadata?.labels?.['io.cattle.field/appId'];
          const name = e.object.metadata?.name || '';
          if (!appId) return;
          await Promise.all(
            resources.map(async (resource: k8s.KubernetesObject) => {
              if (
                !(
                  `${this.labelNamespace}/touched` in
                  (resource.metadata?.labels || {})
                ) &&
                !('io.cattle.field/appId' in (resource.metadata?.labels || {}))
              ) {
                if (this.isCattleAppResource(name, resource)) {
                  const message = `label 'io.cattle.field/appId=${appId}' to '${resource.kind?.toLowerCase()}/${
                    resource.metadata?.name
                  }' in namespace '${resource.metadata?.namespace}'`;
                  this.spinner.start(`ADDING ${message}`);
                  await this.labelResourceAppId(resource, appId);
                  this.spinner.succeed(`ADDED ${message}`);
                }
              }
            })
          );
        } catch (err) {
          this.spinner.fail(
            [
              err.message || '',
              err.body?.message || err.response?.body?.message || ''
            ].join(': ')
          );
          if (this.config.debug) this.log.error(err);
        }
      }
    );
  }

  protected isCattleAppResource(name: string, resource: any) {
    const NAME_REGEX = new RegExp(`${name}`, 'g');
    return NAME_REGEX.test(resource.metadata.name);
  }

  protected async labelResourceAppId(
    resource: k8s.KubernetesObject,
    appId: string
  ): Promise<void> {
    if (!resource.kind) return;
    const result = await this.patchNamespaced(
      Helm2CattleOperator.resourcesLookup[resource.kind],
      resource.kind,
      resource,
      appId
    );
    if (!result) return;
  }

  protected async getResources(e: ResourceEvent): Promise<any[]> {
    const promises = [
      ...Helm2CattleOperator.customResourcesLookup.map(
        async (customResource: CustomResourceLookup) => {
          if (!e.meta.namespace) return [];
          return (
            await this.customObjectsApi.listNamespacedCustomObject(
              customResource.group,
              customResource.version,
              e.meta.namespace,
              customResource.plural
            )
          ).body;
        }
      ),
      ...Object.entries(
        Helm2CattleOperator.resourcesLookup
      ).map(async ([kind, api]: [string, string]) =>
        this.listNamespaced(api, kind, e.meta.namespace)
      )
    ];
    return (await Promise.all(promises)).flat();
  }

  protected async patchNamespaced(
    api: string,
    kind: string,
    resource: k8s.KubernetesObject,
    appId: string
  ): Promise<k8s.KubernetesObject | undefined> {
    const { metadata } = resource;
    if (!metadata?.name || !metadata?.namespace) return;
    const { body } = await (this as any)[api][`readNamespaced${kind}`](
      metadata.name,
      metadata.namespace
    );
    return await (this as any)[api][`patchNamespaced${kind}`](
      metadata.name,
      metadata.namespace,
      [
        {
          op: 'replace',
          path: '/metadata/labels',
          value: {
            ...(body.metadata?.labels || {}),
            'io.cattle.field/appId': appId,
            [`${this.labelNamespace}/touched`]: Date.now().toString()
          }
        }
      ],
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: { 'Content-Type': 'application/json-patch+json' }
      }
    );
  }

  protected async listNamespaced(
    api: string,
    kind: string,
    ns: string | undefined
  ): Promise<k8s.KubernetesObject[]> {
    return ns
      ? (await (this as any)[api][`listNamespaced${kind}`](ns)).body.items.map(
          (item: any) => ({
            ...item,
            kind
          })
        )
      : [];
  }
}
