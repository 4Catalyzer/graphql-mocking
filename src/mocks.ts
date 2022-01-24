import type { MockGraphQLFieldResolver } from '.';
import type { MockFn } from './store';

export const fieldName: MockGraphQLFieldResolver = (
  _obj,
  _args,
  _ctx,
  info,
) => {
  return info.fieldName;
};

export const uuid: MockFn = (faker) => faker.datatype.uuid();

export const string: MockFn = (faker) => faker.random.word();

export const float: MockFn = (faker) =>
  faker.datatype.float({ min: 0, max: 200 });

export const int: MockFn = (faker) =>
  Math.trunc(faker.datatype.float({ min: 0, max: 200 }));

export const bool: MockFn = (faker) => faker.datatype.boolean();

export const datetime: MockFn = (faker) =>
  faker.datatype.datetime().toISOString();

export const date: MockFn = (faker) =>
  faker.datatype.datetime().toISOString().split('T')[0];
