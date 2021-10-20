import type { MockGraphQLFieldResolver } from '.';
import { Faker } from './utils';

export const createFakerResolver =
  (fn: (f: Faker) => any): MockGraphQLFieldResolver =>
  (_obj, _args, _ctx, info) =>
    fn(info.faker);

export const fieldName: MockGraphQLFieldResolver = (
  _obj,
  _args,
  _ctx,
  info,
) => {
  return info.fieldName;
};

export const uuid = createFakerResolver((faker) => faker.datatype.uuid());

export const string = createFakerResolver((faker) => faker.random.word());

export const float = createFakerResolver((faker) =>
  faker.datatype.float({ min: 0, max: 200 }),
);

export const int = createFakerResolver((faker) =>
  Math.trunc(faker.datatype.float({ min: 0, max: 200 })),
);

export const bool = createFakerResolver((faker) => faker.datatype.boolean());

export const datetime = createFakerResolver((faker) =>
  faker.datatype.datetime().toISOString(),
);
export const date = createFakerResolver(
  (faker) => faker.datatype.datetime().toISOString().split('T')[0],
);
