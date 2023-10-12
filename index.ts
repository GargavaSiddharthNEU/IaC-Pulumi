import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Setup Pulumi Config
const config = new pulumi.Config();

const vpcCidr = config.require("vpcCidr");
const region = config.require("region");
const subnetCount = config.getNumber("subnetCount") || 3;  // Default to 3 if not set
const publicSubnetBaseCIDR = config.require("publicSubnetBaseCIDR");
const privateSubnetBaseCIDR = config.require("privateSubnetBaseCIDR");


// Generate subnet CIDRs dynamically
const generateSubnetCidrs = (base: string, count: number): string[] => {
    const baseParts = base.split(".");
    const thirdOctet = parseInt(baseParts[2], 10);
    return Array.from({ length: count }, (_, i) => `${baseParts[0]}.${baseParts[1]}.${thirdOctet + i}.0/24`);
}

const publicSubnetCidrs = generateSubnetCidrs(publicSubnetBaseCIDR, subnetCount);
const privateSubnetCidrs = generateSubnetCidrs(privateSubnetBaseCIDR, subnetCount);

// 1. Create Virtual Private Cloud (VPC).
const vpc = new aws.ec2.Vpc("myVpc", {
    cidrBlock: vpcCidr,
    tags:{
        Name:`vpc-${pulumi.getStack()}`
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

const availabilityZones = aws.getAvailabilityZones();


const publicSubnets = publicSubnetCidrs.map((cidr: string, idx: number) => {
    // Use the fetched availability zones for the subnets
    return availabilityZones.then((azs: any) => {
        return createSubnet(`publicSubnet-${idx}`, cidr, azs.names[idx], true);
    });
});


const privateSubnets = privateSubnetCidrs.map((cidr: string, idx: number) => {
    // Use the fetched availability zones for the subnets
    return availabilityZones.then((azs: any) => {
        return createSubnet(`privateSubnet-${idx}`, cidr, azs.names[idx], true);
    });
});

// 3. Create an Internet Gateway resource and attach it to the VPC.
const internetGateway = new aws.ec2.InternetGateway("AssignmentInternetGateway", {
    vpcId: vpc.id,
    tags:{
        Name:`igw-${pulumi.getStack()}`
    }
});

// 4. Create a public route table and associate public subnets.
const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    tags:{
        Name:`public_route_table-${pulumi.getStack()}`
    }
});


Promise.all(publicSubnets).then(resolvedSubnets => {
    resolvedSubnets.forEach((subnet: aws.ec2.Subnet, idx: number) => {
        new aws.ec2.RouteTableAssociation(`publicRta-${idx}`, {
            subnetId: subnet.id,
            routeTableId: publicRouteTable.id,
        });
    });
});

// 5. Create a private route table and associate private subnets.
const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
    vpcId: vpc.id,
    tags:{
        Name:`private_route_table-${pulumi.getStack()}`
    }
});


Promise.all(privateSubnets).then(resolvedSubnets => {
    resolvedSubnets.forEach((subnet: aws.ec2.Subnet, idx: number) => {
        new aws.ec2.RouteTableAssociation(`privateRta-${idx}`, {
            subnetId: subnet.id,
            routeTableId: privateRouteTable.id,
        });
    });
});

// 6. Create a public route in the public route table.
const publicRoute = new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: internetGateway.id,
});

// Exporting the VPC id for reference.
export const exportedVpcId = vpc.id;

