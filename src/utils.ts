import faker from 'faker';
// @ts-expect-error no types
import Faker from 'faker/lib';
import {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  getNamedType,
  getNullableType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
} from 'graphql';

faker.seed(9000);

export type Faker = typeof faker;

const fakerCache = new Map<string, Faker>();

function hash(str: string) {
  /* eslint-disable */
  for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++)
    (h = Math.imul(h ^ str.charCodeAt(i), 3432918353)),
      (h = (h << 13) | (h >>> 19));
  return h;
  /* eslint-enable */
}

export function seedFaker(str: string): Faker {
  let f = fakerCache.get(str);

  if (!f) {
    // eslint-disable-next-line global-require
    f = new Faker({ locales: require('faker/lib/locales') });
    f!.seed(hash(str));
    fakerCache.set(str, f!);
  }
  return f!;
}

function getNullableNamedType(v: GraphQLType) {
  return getNamedType(getNullableType(v));
}

export interface Ref {
  $$ref: { type: string; id: string };
}

export interface Item {
  [fields: string]: unknown | Ref;
}

export { getNullableNamedType, faker };

export function isRef(v: any): v is Ref {
  return typeof v === 'object' && v && '$$ref' in v;
}

export function isRefableType(v: GraphQLType) {
  if (isNonNullType(v)) v = v.ofType;
  return isObjectType(v) || isInterfaceType(v) || isListType(v);
}

export const valueOrRefId = (v: any) => (isRef(v) ? v.$$ref.id : v);

export function isRootType(type: GraphQLObjectType, schema: GraphQLSchema) {
  const queryType = schema.getQueryType();
  const isOnQueryType = queryType != null && queryType.name === type.name;

  const mutationType = schema.getMutationType();
  const isOnMutationType =
    mutationType != null && mutationType.name === type.name;

  const subscriptionType = schema.getSubscriptionType();
  const isOnSubscriptionType =
    subscriptionType != null && subscriptionType.name === type.name;

  return isOnQueryType || isOnMutationType || isOnSubscriptionType;
}
