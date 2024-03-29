const contentType = 'application/json';
const errorModelName = 'error';
var openapi={
    openapi: '3.0.1',
    info: {},
    servers: {},
    paths: {},
    components: {schemas:{},responses:{}},
    security: {},
    tags: {},
    externalDocs: {},
};
openapi.components.schemas[errorModelName]={
  type:"object",
  properties:{}
};
function toOpenapi(apiData,projectData) {
  openapi.info=getInfo(projectData);
  openapi.servers=getServers(projectData);
  openapi.paths = getPaths(apiData);
  openapi.security = getSecurity();
  openapi.tags = getTags();
  openapi.externalDocs=getExternalDocs();
  return openapi;
}

function getInfo(project) {
  return {
    title: project.title||project.name,
    description: project.description,
    version: project.version,
  };
}

function getServers(project) {
  return [
    {
      url: project.url,
    },
  ];
}


function getPaths(data) {
  const pathsObject = {};
  for (const item of data) {
    const endpoint = toPatternedFieldname(item.url);
    let pathItemObject = pathsObject[endpoint];
    if (!pathItemObject) {
      pathItemObject = pathsObject[endpoint] = {};
    }

    const httpMethod = item.type;
    const operationObject = pathItemObject[httpMethod] = {
      summary: item.title||item.name,
      description: item.description,
      operationId: `${item.group}.${item.name}`,
      parameters: [],
      requestBody: {},
      responses: {},
    };
    const parameterObjects = operationObject.parameters;
    const requestBodyObject = operationObject.requestBody;
    const responsesObject = operationObject.responses;
    const modelName=(item.group||"default").toLowerCase();
    const model =openapi.components.schemas[modelName]={
      "type":"object",
      properties: {},
    }

    const params = [
      ...(item.header ? item.header.fields.Header : []),
      ...(item.parameter ? item.parameter.fields.Parameter : []),
    ];
    for (const param of filterParentParams(params)) {
      const isPathParam = item.url.split('/').indexOf(`:${param.field}`) !== -1;
      const isHeader = !isPathParam && param.group === 'Header';
      const isQueryParam = !isHeader && ['get', 'delete'].indexOf(httpMethod) !== -1;
      const isBodyParam = !isQueryParam;
      if (isPathParam || isHeader || isQueryParam) {
        const name = param.field;
        if(typeof model[name] == "undefined"){
          const schema = getSchema(params, param);
          schema.description=schema.description||param.description,
          model[name]= schema;
        }
        
        const parameterObject = {
          name: name,
          description: param.description,
          in: (isPathParam && 'path') || (isHeader && 'header') || (isQueryParam && 'query'),
          required: !param.optional,
          schema: {"$ref":`#/components/schemas/${modelName}/properties/${name}`},
        };
        parameterObjects.push(parameterObject);
      } else if (isBodyParam) {
        // TODO: Is it possible to de-dup this block
        // to reuse `getSchema()` to handle the schema
        // entirely.
        if (!Object.keys(requestBodyObject).length) {
          Object.assign(requestBodyObject, {
            required: true,
            content: {
              [contentType]: {
                schema: {
                  type: 'object',
                  properties: {},
                  required: [],
                },
              },
            },
          });
        }
        const property = param.field;
        model.properties[property] = {...getSchema(params, param),description:param.description};

        const schema = requestBodyObject.content[contentType].schema;
        schema.properties[property]={
          "$ref":`#/components/schemas/${modelName}/properties/${property}`
        }
        if (!param.optional) {
          schema.required.push(property);
        }
      }
    }

    const responseGroups = [
      ...(item.success ? Object.values(item.success.fields) : []),
      ...(item.error ? Object.values(item.error.fields) : []),
    ];
    
    for (const responses of responseGroups) {
      let responseObject;
      let schema;
      let isOkStatus=true;
      for (const response of filterParentParams(responses)) {
        if (!responseObject) {
          // apiDoc success group defaults to 'Success 200'.
          // apiDoc error group defaults to 'Error 4xx'.
          const statusCode = response.group.replace(/(Success|Error)\ /, '').toUpperCase();
          isOkStatus=200<=statusCode&&statusCode<300;
          responseObject = {
            content: {
              [contentType]: {
                schema: {
                  type:"object",
                  properties:{},
                  required:[]
                },
              },
            },
          };
          if(isOkStatus){
            responsesObject[statusCode] = responseObject;
          }else if(400<=statusCode&&statusCode<500){
            openapi.components.responses[statusCode]=responseObject;
            responsesObject[statusCode]={
              "$ref":`#/components/responses/${statusCode}`
            }
          }
        }
        const property = response.field;
        schema =responseObject.content[contentType].schema;
        const propertySchema={...getSchema(responses, response),description:response.description};
        const refModelName=isOkStatus?modelName:errorModelName;
        const refModel = isOkStatus?model:openapi.components.schemas[errorModelName]
        refModel.properties[property] = propertySchema;
        schema.properties[property]={
          "$ref":`#/components/schemas/${refModelName}/properties/${property}`
        }
        
        if (!response.optional) {
          schema.required.push(property);
        }
      }
    }

    if (item.deprecated) {
      operationObject.deprecated = true;
    }

    if (!parameterObjects.length) {
      delete operationObject.parameters;
    }
    if (!Object.keys(requestBodyObject).length) {
      delete operationObject.requestBody;
    }
  }

  return pathsObject;
}


function getSecurity() {}

function getTags() {}

function getExternalDocs() {}


function toPatternedFieldname(url) {
  return url.split('/').map((segment) => {
    if (segment[0] === ':') {
      return '{' + segment.slice(1) + '}';
    }
    return segment;
  }).join('/');
}


function filterParentParams(params) {
  return params.filter((param) => param.field.indexOf('.') === -1);
}


function getSchema(params, param) {
  const isArray = param.type.indexOf('[]') !== -1;
  // exclude array objects
  const isObject = isArray && param.type === 'Object';
  
  const childParams = params.filter((p) => {
    const ppath = `${param.field}.`;
    return p.field.indexOf(ppath) === 0 &&
      p.field.replace(ppath, '').indexOf('.') === -1;
  });

  let schema;

  if (isObject) {
    schema = {
      type: 'object',
      properties: {},
      required: [],
    };
    for (const p of childParams) {
      const prop = p.field.replace(`${param.field}.`, '');
      schema.properties[prop] = getSchema(params, p);
      if (!p.optional) {
        schema.required.push(prop);
      }
    }
  } else if (isArray) {
    schema = {
      type: 'array',
      items: getSchema(params, Object.assign({}, param, {
        type: param.type.replace('[]', ''),
      })),
    };
  } else {
    schema = {
      type: param.type.toLowerCase(),
    };
  }

  return schema;
}



module.exports = {
    toOpenapi: toOpenapi
};
