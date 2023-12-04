import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as gcp from "@pulumi/gcp";

// Setup Pulumi Config
const config = new pulumi.Config();

const vpcCidr = config.require("vpcCidr");
const region = config.require("region");
const subnetCount = config.getNumber("subnetCount") || 3;  // Default to 3 if not set
const publicSubnetBaseCIDR = config.require("publicSubnetBaseCIDR");
const privateSubnetBaseCIDR = config.require("privateSubnetBaseCIDR");
const vpcNameF = config.require("vpcName");
const igwNameF = config.require("igwName");
const publicrouteNameF = config.require("publicrouteName");
const privaterouteNameF = config.require("privaterouteName");
const dbPassword = config.requireSecret("dbPassword");
const dbUser = config.require("dbUser");
const dbPostgresql = config.require("dbPostgresql");
const mailgun_api = config.requireSecret("mailgunkey");
const gcpProjectId = config.require("GCP_PROJECT_ID");

// Assuming you have the hosted zone ID as a Pulumi config value
const hostedZoneId = config.require("hostedZoneId");

const availabilityZones = aws.getAvailabilityZones();

const determineSubnetCount = availabilityZones.then(azs => {
    if (azs.names.length < subnetCount) {
        return azs.names.length;
    }
    return subnetCount;
});

const generateSubnetCidrsAsync = (base: string, countPromise: Promise<number>): Promise<string[]> => {
    return countPromise.then(count => {
        const baseParts = base.split(".");
        const thirdOctet = parseInt(baseParts[2], 10);
        return Array.from({ length: count }, (_, i) => `${baseParts[0]}.${baseParts[1]}.${thirdOctet + i}.0/24`);
    });
}


const publicSubnetCidrsPromise = generateSubnetCidrsAsync(publicSubnetBaseCIDR, determineSubnetCount);
const privateSubnetCidrsPromise = generateSubnetCidrsAsync(privateSubnetBaseCIDR, determineSubnetCount);

// 1. Create Virtual Private Cloud (VPC).
const vpc = new aws.ec2.Vpc("myVpc", {
    cidrBlock: vpcCidr,
    tags:{
        Name: vpcNameF
        //Name:`vpc-${pulumi.getStack()}`
    }
});

// 2. Create subnets in your VPC.
const createSubnet = (name: string, cidr: string, az: string, isPublic: boolean) => {
    return new aws.ec2.Subnet(name, {
        vpcId: vpc.id,
        cidrBlock: cidr,
        availabilityZone: az,
        mapPublicIpOnLaunch: isPublic,
    });
};


const publicSubnets = pulumi.all([publicSubnetCidrsPromise, availabilityZones])
    .apply(([cidrs, azs]) => cidrs.map((cidr: string, idx: number) => {
        return createSubnet(`publicSubnet-${idx}`, cidr, azs.names[idx], true);
    }));


const privateSubnets = pulumi.all([privateSubnetCidrsPromise, availabilityZones])
    .apply(([cidrs, azs]) => cidrs.map((cidr: string, idx: number) => {
        return createSubnet(`privateSubnet-${idx}`, cidr, azs.names[idx], false);
    }));

// 3. Create an Internet Gateway resource and attach it to the VPC.
const internetGateway = new aws.ec2.InternetGateway("AssignmentInternetGateway", {
    vpcId: vpc.id,
    tags:{
        Name:igwNameF
        //Name:`igw-${pulumi.getStack()}`
    }
});

// 4. Create a public route table and associate public subnets.
const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    tags:{
        Name:publicrouteNameF
        //Name:`public_route_table-${pulumi.getStack()}`
    }
});


pulumi.all([publicSubnets, publicRouteTable]).apply(([subnets, rt]) => {
    subnets.forEach((subnet, idx) => {
        new aws.ec2.RouteTableAssociation(`publicRta-${idx}`, {
            subnetId: subnet.id,
            routeTableId: rt.id,
        });
    });
});

// 5. Create a private route table and associate private subnets.
const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
    vpcId: vpc.id,
    tags:{
        Name:privaterouteNameF
        //Name:`private_route_table-${pulumi.getStack()}`
    }
});


pulumi.all([privateSubnets, privateRouteTable]).apply(([subnets, rt]) => {
    subnets.forEach((subnet, idx) => {
        new aws.ec2.RouteTableAssociation(`privateRta-${idx}`, {
            subnetId: subnet.id,
            routeTableId: rt.id,
        });
    });
});

// 6. Create a public route in the public route table.
const publicRoute = new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: internetGateway.id,
});

//Assignment-9 starts

    // Load Balancer Security Group
    const lbSecurityGroup = new aws.ec2.SecurityGroup("LbSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for the load balancer",
        ingress: [
            { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] }
        ],
        egress: [
            { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }
        ]
    });

    //Updated App security group
    const appSecurityGroup = new aws.ec2.SecurityGroup("AppSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for web applications",
        ingress: [
            //{ protocol: "tcp", fromPort: 22, toPort: 22, securityGroups: [lbSecurityGroup.id] },
            { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 8080, toPort: 8080, securityGroups: [lbSecurityGroup.id] }
        ],
        egress: [       
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"]
            }
        ],
        tags: {
            Name: "ApplicationSecurityGroup",
            // Other relevant tags can be added here
        }
    });

    //Assignment-9 pause

const latestAmiPromise = aws.ec2.getAmi({
    mostRecent: true,
    filters: [
        {
            name: 'state',
            values: ['available'],
        },
    ],
    owners: ["388344348771"],
});

const latestAmi = pulumi.output(latestAmiPromise);


//Assignment-6

    const rdsSecurityGroup = new aws.ec2.SecurityGroup("RdsSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for RDS instances",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 5432,
                toPort: 5432,
                securityGroups: [appSecurityGroup.id]  // Allowing traffic from the application security group
            }
        ],
        egress: [       
            {
                protocol: "tcp",
                fromPort: 5432,
                toPort: 5432,
                securityGroups: [appSecurityGroup.id]
            }
        ],
        tags: {
            Name: "DatabaseSecurityGroup"
        }
    });

    const rdsParameterGroup = new aws.rds.ParameterGroup("rdsparametergroup", {
        family: "postgres15",  
        tags: {
            Name: "rdsparametergroup"
        }
    });

    const dbSubnetGroupName = "csye-db-subnet-group"

    const rdsSubnetGroup = new aws.rds.SubnetGroup(dbSubnetGroupName, {

        subnetIds: [privateSubnets[0].id, privateSubnets[1].id],

    });

    const rdsInstance = new aws.rds.Instance("RDSInstance", {
        engine: "postgres",
        instanceClass: "db.t3.micro",
        allocatedStorage: 20,
        name: dbPostgresql,
        username: dbUser,
        password: dbPassword,
        parameterGroupName: rdsParameterGroup.name,
        skipFinalSnapshot: true,
        dbSubnetGroupName: rdsSubnetGroup.name, // DB subnet group using the private subnets
        vpcSecurityGroupIds: [rdsSecurityGroup.id],
        multiAz: false,
        publiclyAccessible: false,
        identifier: "csye6225",
        tags: {
            Name: "RDSInstance"
        }
    });
    
    //Assignment-7
    // CloudWatch Agent IAM Role and Policy Attachment
    const cloudwatchAgentRole = new aws.iam.Role("cloudwatchAgentRole", {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Action: 'sts:AssumeRole',
                Principal: {
                    Service: 'ec2.amazonaws.com'
                },
                Effect: 'Allow',
            }]
        })
    });

    const policyAttachment = new aws.iam.RolePolicyAttachment('cloudWatchAgentPolicyAttachment', {
        role: cloudwatchAgentRole.name,
        policyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy'
    });

    // Create an IAM Instance Profile for our EC2 instance
    const cloudwatchAgentInstanceProfile = new aws.iam.InstanceProfile("cloudwatchAgentInstanceProfile", {
        role: cloudwatchAgentRole.name,
    });

    //Assignment-10 starts

    const bucket = new gcp.storage.Bucket("csye-6225-siddharthgargava-2023", {
        location: "us-central1",
        forceDestroy: true,
        versioning: {
            enabled: true,
          },
        //versioning: true,
    });
 
    const serviceAccount = new gcp.serviceaccount.Account("myServiceAccount", {
        accountId: "gcp-bucket-service-account",
        displayName: "GCP Bucket Service Account",
    });
 
    const bucketAccess = new gcp.storage.BucketIAMBinding("bucketAccess", {
        bucket: bucket.name,
        role: "roles/storage.objectAdmin",
        members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
    });
 
    const serviceAccountKeys = new gcp.serviceaccount.Key("myServiceAccountKeys", {
        serviceAccountId: serviceAccount.id,
    });
 
    const emailTopic = new aws.sns.Topic("csyeEmail", {
        displayName: "CSYE EMAIL TOPIC",
    });
 
    const lambdaRoleEmail = new aws.iam.Role("LambdaEmailRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Principal: {
                    Service: ["lambda.amazonaws.com"],
                },
                Action: ["sts:AssumeRole"],
            }],
        }),
    });
 
    const cloudWatchLogsAttachmentEmail = new aws.iam.RolePolicyAttachment("lambdaPolicy-CloudWatchLogsEmail", {
        role: lambdaRoleEmail.name,
        policyArn: "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
    });
 
    const s3FullAccessAttachmentEmail = new aws.iam.RolePolicyAttachment("lambdaPolicy-S3FullAccessEmail", {
        role: lambdaRoleEmail.name,
        policyArn: "arn:aws:iam::aws:policy/AmazonS3FullAccess",
    });
 
    const lambdaFullAccessAttachmentEmail = new aws.iam.RolePolicyAttachment("lambdaPolicy-LambdaFullAccessEmail", {
        role: lambdaRoleEmail.name,
        policyArn: "arn:aws:iam::aws:policy/AWSLambda_FullAccess",
    });
 
    const dynamoDBFullAccessAttachmentEmail = new aws.iam.RolePolicyAttachment("lambdaPolicy-DynamoDBFullAccessEmail", {
        role: lambdaRoleEmail.name,
        policyArn: "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
    });

    // const snsPublishPolicy = new aws.iam.Policy("SNSPublishPolicy", {
    //     policy: JSON.stringify({
    //         Version: "2012-10-17",
    //         Statement: [{
    //             Effect: "Allow",
    //             Action: "sns:Publish",
    //             Resource: emailTopic.arn, 
    //         }],
    //     })
    // });

    const snsPublishPolicy = new aws.iam.Policy("SNSPublishPolicy", {
        policy: emailTopic.arn.apply(arn => JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: "sns:Publish",
                Resource: arn,
            }],
        }))
    });
    
    
    const snsPolicyAttachment = new aws.iam.PolicyAttachment("snsPolicyAttachment", {
        policyArn: snsPublishPolicy.arn,
        roles: [cloudwatchAgentRole.name], 
    });

    const dynamoDB = new aws.dynamodb.Table("csye-6225", {
        name:"csye-6225",
        attributes: [  
            { name: "emailSentAt", type: "S" }, 
            {name: "message", type: "S"}, 
        ],
        hashKey: "emailSentAt",
        rangeKey: "message",
        billingMode: "PAY_PER_REQUEST",
        // readCapacity: 1,
        // writeCapacity: 1,
    });

    const lambdaFunctionEmail = new aws.lambda.Function("csyeLambda", {
        role: lambdaRoleEmail.arn,
        runtime: "nodejs18.x",
        handler: "index.handler",
        code:  new pulumi.asset.FileArchive("./serverless.zip"),
        environment: {
            variables: {
                GOOGLE_STORAGE_BUCKET_NAME: bucket.name,
                GOOGLE_SERVICE_ACCOUNT_KEY: serviceAccountKeys.privateKey,
                GCP_PROJECT_ID: gcpProjectId,
                GCP_SERVICE_ACCOUNT_EMAIL: serviceAccount.email,
                MAILGUN_API: mailgun_api,
                DYNAMO_TABLE_NAME: dynamoDB.name,
            },
        },
    });


     
 
    const snsSubscriptionEmail = new aws.sns.TopicSubscription(`csyeSNSSubscriptionEmail`, {
        topic: emailTopic.arn,
        protocol: "lambda",
        endpoint: lambdaFunctionEmail.arn,
    });
 
    const lambdaPermissionEmail = new aws.lambda.Permission("with_sns_email", {
        statementId: "AllowExecutionFromSNSEmail",
        action: "lambda:InvokeFunction",
        function: lambdaFunctionEmail.name,
        principal: "sns.amazonaws.com",
        sourceArn: emailTopic.arn,
    });


    //Fetch your Route53 Hosted Zone using the hostedZoneId
    const hostedZone = aws.route53.getZone({ zoneId: hostedZoneId });
    
    // 8. EC2 Instance
    // const ec2Instance = new aws.ec2.Instance("AppEC2Instance", {
    //     ami: latestAmi.apply(ami => ami.id),  
    //     instanceType: "t2.micro",   // Choosing instance type
    //     keyName: "ec2-aws-test",   // Add SSH key
    //     vpcSecurityGroupIds: [appSecurityGroup.id],
    //     //iamInstanceProfile: cloudwatchAgentInstanceProfile.name,
    //     subnetId: publicSubnets[0].id,  // Launching in the first public subnet
    //     rootBlockDevice: {
    //         volumeType: "gp2",
    //         volumeSize: 25,
    //         deleteOnTermination: true
    //     },
    //     disableApiTermination: false,
    //     userData: pulumi.interpolate`#!/bin/bash
    //     cd /opt/webapp
    //     rm .env
    //     touch .env
    //     echo DB_HOST=${rdsInstance.address} >> /opt/webApp/.env
    //     echo DB_POSTGRESQL=${dbPostgresql} >> /opt/webApp/.env
    //     echo DB_USER=${dbUser} >> /opt/webApp/.env
    //     echo DB_PASSWORD=${dbPassword} >> /opt/webApp/.env
    //     sudo systemctl restart webApp.service
    //     sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    //     -a fetch-config \
    //     -m ec2 \
    //     -c file:/opt/webApp/AmazonCloudWatch-cloudwatch-config.json \
    //     -s
    //     sudo systemctl enable amazon-cloudwatch-agent
    //     sudo systemctl start amazon-cloudwatch-agent`,
    //     // dependsOn: [rdsDatabase],
    //     tags: {
    //         Name: "AppEC2Instance",
    //     }
    // });

    //Assignment-9 restarts

     //Load Balancer
     const appLoadBalancer = new aws.lb.LoadBalancer("AppLoadBalancer", {
        name: "loadbalancer-siddharth",
        internal: false,
        loadBalancerType: "application",
        //sslPolicy: "ELBSecurityPolicy-2016-08",
        enableHttp2: true,
        securityGroups: [lbSecurityGroup.id],
        subnets: publicSubnets.apply(subnets => subnets.map(subnet => subnet.id)),
        enableDeletionProtection: false,
    });
    
    // Target Group for Load Balancer
    const targetGroup = new aws.lb.TargetGroup("AppTargetGroup", {
        port: 8080,
        protocol: "HTTP",
        vpcId: vpc.id,
        targetType: "instance",
        healthCheck: {
            healthyThreshold: 3,
            unhealthyThreshold: 3,
            timeout: 10,
            interval: 30,
            path: "/healthz",
            port: "8080",
            matcher: "200",
        },
    });
    
    new aws.lb.Listener("AppListener", {
        loadBalancerArn: appLoadBalancer.arn,
        port: 443,
        protocol: "HTTPS",
        sslPolicy: "ELBSecurityPolicy-2016-08",
        certificateArn: "arn:aws:acm:us-east-1:075160867462:certificate/b5875ed7-6b42-4776-b7fa-481074b642aa",
        defaultActions: [{
            type: "forward",
            targetGroupArn: targetGroup.arn,
        }],
    });

    const userDataScript = pulumi.interpolate`#!/bin/bash
    cd /opt/webapp
    rm .env
    touch .env
    echo DB_HOST=${rdsInstance.address} >> /opt/webApp/.env
    echo DB_POSTGRESQL=${dbPostgresql} >> /opt/webApp/.env
    echo DB_USER=${dbUser} >> /opt/webApp/.env
    echo DB_PASSWORD=${dbPassword} >> /opt/webApp/.env
    echo TOPICARN=${emailTopic.arn} >> /opt/webApp/.env
    sudo systemctl restart webApp.service
    
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/webApp/AmazonCloudWatch-cloudwatch-config.json \
    -s
    sudo systemctl enable amazon-cloudwatch-agent
    sudo systemctl start amazon-cloudwatch-agent`;

    // Auto Scaling Setup (D)
    const launchTemplate = new aws.ec2.LaunchTemplate("AppLaunchTemplate", {
        name: "webapp-launch-template",
        imageId: latestAmi.apply(ami => ami.id),
        instanceType: "t2.micro",
        keyName: "ec2-aws-test",
        networkInterfaces: [{
            associatePublicIpAddress: "true",
            securityGroups: [appSecurityGroup.id],
        }],
        disableApiTermination: false, //change
        //Mapping change
        blockDeviceMappings: [
            {
                deviceName: "/dev/xvda",
                ebs: {
                    volumeSize: 25,
                    volumeType: "gp2",
                    deleteOnTermination: "true",
                },
            },
        ],
        iamInstanceProfile: {
            name: cloudwatchAgentInstanceProfile.name,
            //name: cloudwatchAgentInstanceProfile.name.apply(name => name),
        },
        // userData: pulumi.interpolate`#!/bin/bash
        // cd /opt/webapp
        // rm .env
        // touch .env
        // echo DB_HOST=${rdsInstance.address} >> /opt/webApp/.env
        // echo DB_POSTGRESQL=${dbPostgresql} >> /opt/webApp/.env
        // echo DB_USER=${dbUser} >> /opt/webApp/.env
        // echo DB_PASSWORD=${dbPassword} >> /opt/webApp/.env
        // sudo systemctl restart webApp.service
        // sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
        // -a fetch-config \
        // -m ec2 \
        // -c file:/opt/webApp/AmazonCloudWatch-cloudwatch-config.json \
        // -s
        // sudo systemctl enable amazon-cloudwatch-agent
        // sudo systemctl start amazon-cloudwatch-agent`,
        userData: userDataScript.apply((data) => Buffer.from(data).toString("base64")),
        tags: {
            Name: "csye6225_asg",
        },
    });
    
    //Autoscaling group
    const autoScalingGroup = new aws.autoscaling.Group("AppAutoScalingGroup", {
        name:"csye6225_asg",
        vpcZoneIdentifiers: publicSubnets.apply(subnets => subnets.map(subnet => subnet.id)),
        maxSize: 3,
        minSize: 1,
        desiredCapacity: 1,
        forceDelete: true,
        defaultCooldown: 60,
        launchTemplate: {
            id: launchTemplate.id,
            version: `$Latest`
        },
        targetGroupArns: [targetGroup.arn],
        tags: [
            { key: "Name", value: "AppEC2Instance", propagateAtLaunch: true },
        ],
    });

     //Scaling policy

    // Auto Scaling Policies (F)
    const scaleUpPolicy = new aws.autoscaling.Policy("scaleUp", {
        scalingAdjustment: 1,
        adjustmentType: "ChangeInCapacity",
        cooldown: 60,
        autoscalingGroupName: autoScalingGroup.name,
        policyType: "SimpleScaling",
        metricAggregationType: "Average",
    });

    const scaleDownPolicy = new aws.autoscaling.Policy("scaleDown", {
        scalingAdjustment: -1,
        adjustmentType: "ChangeInCapacity",
        cooldown: 60,
        autoscalingGroupName: autoScalingGroup.name,
        policyType: "SimpleScaling",
        metricAggregationType: "Average",
    });

    //ALARMS:

    // CloudWatch Alarm for Scaling Up
    const scaleUpAlarm = new aws.cloudwatch.MetricAlarm("scaleUpAlarm", {
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        statistic: "Average",
        period: 60,
        evaluationPeriods: 1,
        threshold: 5, // Set appropriate CPU threshold
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        alarmActions: [scaleUpPolicy.arn],
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
    });
    

    // CloudWatch Alarm for Scaling Down
    const scaleDownAlarm = new aws.cloudwatch.MetricAlarm("scaleDownAlarm", {
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        statistic: "Average",
        period: 60,
        evaluationPeriods: 1,
        threshold: 3, // Set appropriate CPU threshold
        comparisonOperator: "LessThanOrEqualToThreshold",
        alarmActions: [scaleDownPolicy.arn],
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
    });


    // 2. Create/Update the A record for your EC2 instance within the Hosted Zone
    const domainName = "siddharthgargava.me"; // Replace with your domain name
    const subdomainName = "demos"; // Subdomain for the EC2 instance. Change this if required.

    const aRecord = new aws.route53.Record("aRecord", {
        zoneId: hostedZoneId,
        name: "demos.siddharthgargava.me",
        type: "A",
        //ttl: 60,
        //records: [ec2Instance.publicIp], // This ties the EC2 instance's public IP to the A record
        aliases: [{
            name: appLoadBalancer.dnsName,
            zoneId: appLoadBalancer.zoneId,
            evaluateTargetHealth: true,
        }],
    });

    //Assignment-9 ends
//Assignment-7 end

//Assignment-6 End

// Exporting the VPC id for reference.
export const exportedVpcId = vpc.id;

