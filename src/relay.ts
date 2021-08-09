import {
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  getNamedType,
  getNullableType,
  isInterfaceType,
  isListType,
  isObjectType,
  isScalarType,
} from 'graphql';
import {
  connectionFromArray,
  connectionFromArraySlice,
  fromGlobalId,
  toGlobalId,
} from 'graphql-relay';

import type { MockFieldResolver, MockGraphQLFieldResolver } from '.';
import { uuid } from './mocks';
import { getNullableNamedType } from './utils';

export {
  toGlobalId,
  fromGlobalId,
  connectionFromArray,
  connectionFromArraySlice,
};

function isNodeInterface(intf: GraphQLInterfaceType) {
  if (intf.name !== 'Node') return false;
  const fields = intf.getFields();

  if ('id' in fields) {
    const idType = getNamedType(fields.id.type);
    return idType.name === 'ID' && isScalarType(idType);
  }
  return false;
}

export const getIdInfo = (id: string) => {
  const parts = fromGlobalId(id);
  return toGlobalId(parts.type, parts.id) === id ? parts : null;
};

export const resolveLocalOrGlobalId = (id: string) => {
  const parts = fromGlobalId(id);
  if (toGlobalId(parts.type, parts.id) === id) return parts.id;
  return id;
};

export function hasNodeInterface(schema: GraphQLSchema) {
  const nodeType = schema.getType('Node');
  return nodeType && isInterfaceType(nodeType) && isNodeInterface(nodeType);
}

export function implementsNode(v: GraphQLType) {
  if (!isObjectType(v)) return false;
  const interfaces = v.getInterfaces();
  return interfaces.some(isNodeInterface);
}

export function isConnectionType(v: GraphQLType): v is GraphQLObjectType {
  if (!isObjectType(v)) return false;

  const { edges, nodes, pageInfo } = v.getFields();

  return (
    pageInfo &&
    (edges || nodes) &&
    isListType(getNullableType(edges ? edges.type : nodes.type)) &&
    isObjectType(getNullableType(pageInfo.type))
  );
}

export function getConnectionNodeType(
  connection: GraphQLObjectType,
): GraphQLObjectType {
  const { edges, nodes } = connection.getFields();

  const nodeOrEdgeType = getNamedType(
    (edges || nodes)!.type,
  ) as GraphQLObjectType;

  if (!edges) return nodeOrEdgeType;

  return getNamedType(
    nodeOrEdgeType.getFields().node!.type,
  ) as GraphQLObjectType;
}

export function hasNodeQuery(queryType: GraphQLObjectType) {
  const nodeField = queryType.getFields().node;
  return (
    nodeField && isInterfaceType(nodeField.type) && nodeField.name === 'Node'
  );
}

export const globalIdMock: MockGraphQLFieldResolver = (
  src,
  args,
  ctx,
  info,
) => {
  const parent = getNullableNamedType(info.parentType);
  let id = ctx.mocks.getId(src);

  // always treat mock ids as global so we can reverse them
  if (id) {
    return toGlobalId(parent.name, id);
  }

  id = uuid(src, args, ctx, info);
  return implementsNode(parent) ? toGlobalId(parent.name, id) : id;
};

export const nodeField: MockFieldResolver = ({ id }, { mocks }) => {
  const resolvedId = fromGlobalId(id);
  return {
    ...mocks.get(resolvedId.type, resolvedId.id),
    __typename: resolvedId.type,
  };
};

export const nodeMock: MockGraphQLFieldResolver = (_, { id }, { mocks }) => {
  const resolvedId = fromGlobalId(id);
  return {
    ...mocks.get(resolvedId.type, resolvedId.id),
    __typename: resolvedId.type,
  };
};
