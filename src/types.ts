export interface CustomResourceLookup {
  group: string;
  plural: string;
  version: string;
  kind: string;
}

export interface ResourcesLookup {
  [kind: string]: string;
}

export type Matcher<T> = MatchItem<T> | (MatchItem<T> | MatchItem<T>[])[];

export interface IMatchItem<T> {
  path: string | string[];
  regex: T;
}

export type MatchItem<T = string> = T | IMatchItem<T>;
