const awsConfig = {
    Auth: {
        Cognito: {
            userPoolId: 'us-east-1_ArCBpKAeh',
            userPoolClientId: '28narcb9oerb6pei6pp3gefrmm',
            region: 'us-east-1',
            loginWith: {
                email: true
            }
        }
    }
};

export default awsConfig;
