export interface CustomResourceLookup {
  group: string;
  plural: string;
  version: string;
  kind: string;
}

export interface ResourcesLookup {
  [kind: string]: string;
}
