const awsConfig = {
    Auth: {
        Cognito: {
            userPoolId: 'us-east-1_p9lr7Vc8J',
            userPoolClientId: '678viu6ntftob0eg5vsd05j4m7',
            region: 'us-east-1',
            loginWith: {
                email: true
            }
        }
    }
};

export default awsConfig;
