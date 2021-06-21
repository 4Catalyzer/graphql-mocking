import {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  getNamedType,
  getNullableType,
} from 'graphql';

import faker from 'faker';

faker.seed(9000);

function getNullableNamedType(v: GraphQLType) {
  return getNamedType(getNullableType(v));
}

export { getNullableNamedType, faker };

export function mergeMocks(targetFn: () => any, customMock: any): any {
  if (Array.isArray(customMock)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return customMock.map((el: any) => mergeMocks(targetFn, el));
  }
  if (typeof customMock === 'object' && customMock) {
    return Object.assign(targetFn(), customMock);
  }
  return customMock;
}

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
