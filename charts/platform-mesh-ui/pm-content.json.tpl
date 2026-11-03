{
  "name": "openkcm-ui",
  "luigiConfigFragment": {
    "data": {
      "nodes": [
        {
          "pathSegment": "openkcm",
          "navigationContext": "openkcm-account",
          "label": "Keys",
          "entityType": "main.core_platform-mesh_io_account",
          "icon": "shield",
          "order": __ACCOUNT_NAV_ORDER__,
          "category": {
            "id": "openkcm",
            "isGroup": true,
            "icon": "shield",
            "label": "OpenKCM",
            "collapsible": true,
            "order": __ACCOUNT_NAV_ORDER__
          },
          "keepSelectedForChildren": true,
          "loadingIndicator": {
            "enabled": false
          },
          "context": {
            "openkcmLevel": "account",
            "accountNamespace": "__ACCOUNT_NAMESPACE__",
            "resourceDefinition": {
              "apiGroup": "operations_openkcm_io",
              "version": "v1alpha1",
              "entityCollection": "DomainKeys",
              "entity": "DomainKey",
              "scope": "Namespaced",
              "ui": {
                "detailView": {
                  "fields": [
                    {
                      "label": "Name",
                      "property": "metadata.name"
                    },
                    {
                      "label": "Namespace",
                      "property": "metadata.namespace"
                    },
                    {
                      "label": "Scope",
                      "property": "spec.scope"
                    }
                  ]
                }
              }
            }
          },
          "url": "__HOST__/index.html",
          "children": [
            {
              "pathSegment": "domain-keys",
              "hideFromNav": true,
              "children": [
                {
                  "pathSegment": ":namespace",
                  "hideFromNav": true,
                  "children": [
                    {
                      "pathSegment": ":resourceName",
                      "hideFromNav": true,
                      "url": "/assets/platform-mesh-portal-ui-wc.js#generic-detail-view",
                      "webcomponent": {
                        "selfRegistered": true,
                        "type": "module"
                      },
                      "context": {
                        "namespaceId": ":namespace",
                        "resourceId": ":resourceName"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "pathSegment": "openkcm-members",
          "label": "Members",
          "url": "__HOST__/index.html",
          "viewGroup": "openkcm-l1-managers",
          "context": {
            "openkcmPage": "l1-key-managers",
            "entityName": "account-l1",
            "entityId": "account-l1",
            "resourceId": "account-l1",
            "resourceDefinition": {
              "group": "operations.openkcm.io",
              "kind": "L1KeyAccess",
              "scope": "Cluster"
            },
            "openkcmLevel": "account",
            "accountNamespace": "__ACCOUNT_NAMESPACE__"
          },
          "children": [
            {
              "pathSegment": "add-members",
              "label": "Add L1 Key Managers",
              "hideFromNav": true,
              "url": "__IAM_UI_BASE_URL__#/organization/add-members",
              "viewGroup": "openkcm-l1-members"
            }
          ],
          "entityType": "main.core_platform-mesh_io_account",
          "navigationContext": "openkcm-members",
          "icon": "group",
          "order": __ACCOUNT_NAV_ORDER__,
          "category": {
            "id": "openkcm",
            "isGroup": true,
            "icon": "shield",
            "label": "OpenKCM",
            "collapsible": true,
            "order": __ACCOUNT_NAV_ORDER__
          },
          "keepSelectedForChildren": true,
          "loadingIndicator": {
            "enabled": false
          }
        }
      ]
    }
  }
}
